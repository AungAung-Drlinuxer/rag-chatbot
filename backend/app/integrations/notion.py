"""Notion integration — REST API client for KB page ingestion (cloud SaaS).

Config stored in `system_settings key='notion'` (JSON):
  { api_token, source_ids, domain, max_pages }

  api_token  — Notion *internal integration* secret (ntn_... / secret_...)
  source_ids — optional comma list of page/database IDs to restrict the crawl.
               Empty = every page/database shared with the integration.
  domain     — KB domain tag; empty → auto-classified from title/body
  max_pages  — safety ceiling on pages fetched per sync (default 300)

Auth: `Authorization: Bearer <token>` + the mandatory `Notion-Version` header.

TWO NOTION-SPECIFIC TRAPS this module handles explicitly:

1. SHARING. A valid token still returns 404 for any page the user has not
   explicitly shared with the integration ("... → Connections → add integration").
   `test_connection()` separates "bad token" (401) from "token fine, nothing
   shared" (200 with zero results) so the Settings UI can say which it is.

2. RATE LIMITS. Notion allows roughly 3 requests/second averaged. A recursive
   block walk makes many calls per page, so every request goes through a
   process-wide throttle plus `Retry-After`-aware backoff on 429.

Note: `NotionDirectoryLoader` from LangChain is deliberately NOT used — it reads
an *exported markdown directory*, not the live API. Reading the API directly is
what gives us stable page IDs and a real `source_url` for citations.
"""
from __future__ import annotations

import json
import logging
import threading
import time

from sqlalchemy import text

from app.persistence.database import SessionLocal

logger = logging.getLogger("integrations.notion")

_INTEGRATION_KEY = "notion"
_API = "https://api.notion.com/v1"
_NOTION_VERSION = "2022-06-28"

# --- polite client: at most ~3 req/s process-wide, with 429 backoff --------------
_RATE_LOCK = threading.Lock()
_LAST_CALL = [0.0]
_MIN_INTERVAL = 0.34  # seconds between requests (~3 req/s)

_MAX_BLOCK_DEPTH = 6          # guard against pathological nesting
_MAX_BLOCKS_PER_PAGE = 400    # guard against runaway pages


def _throttle() -> None:
    """Serialise requests so we stay under Notion's ~3 req/s average."""
    with _RATE_LOCK:
        delta = time.monotonic() - _LAST_CALL[0]
        if delta < _MIN_INTERVAL:
            time.sleep(_MIN_INTERVAL - delta)
        _LAST_CALL[0] = time.monotonic()


def _get(url: str, headers: dict, params: dict | None = None, *, client) -> dict | None:
    """GET with throttling + 429/5xx retry. Returns parsed JSON or None."""
    for attempt in range(4):
        _throttle()
        try:
            r = client.get(url, headers=headers, params=params)
        except Exception as exc:
            logger.warning("notion GET failed (%s): %s", url, exc)
            return None
        if r.status_code == 200:
            try:
                return r.json()
            except ValueError:
                return None
        if r.status_code == 429:
            wait = float(r.headers.get("Retry-After") or 1.5)
            logger.info("notion 429 — backing off %.1fs", wait)
            time.sleep(min(wait, 10.0))
            continue
        if 500 <= r.status_code < 600 and attempt < 3:
            time.sleep(1.5 * (attempt + 1))
            continue
        logger.warning("notion GET %s -> HTTP %s", url, r.status_code)
        return None
    return None


def _post(url: str, headers: dict, payload: dict, *, client) -> dict | None:
    for attempt in range(4):
        _throttle()
        try:
            r = client.post(url, headers=headers, json=payload)
        except Exception as exc:
            logger.warning("notion POST failed (%s): %s", url, exc)
            return None
        if r.status_code == 200:
            try:
                return r.json()
            except ValueError:
                return None
        if r.status_code == 429:
            wait = float(r.headers.get("Retry-After") or 1.5)
            logger.info("notion 429 — backing off %.1fs", wait)
            time.sleep(min(wait, 10.0))
            continue
        if 500 <= r.status_code < 600 and attempt < 3:
            time.sleep(1.5 * (attempt + 1))
            continue
        logger.warning("notion POST %s -> HTTP %s", url, r.status_code)
        return None
    return None


def get_notion_cfg() -> dict:
    """Read Notion config from system_settings (JSON string or dict)."""
    try:
        with SessionLocal() as s:
            row = s.execute(
                text("SELECT value FROM system_settings WHERE key = :k"),
                {"k": _INTEGRATION_KEY},
            ).first()
    except Exception as exc:
        logger.warning("notion cfg read failed: %s", exc)
        return {}
    val = row[0] if row else {}
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except (TypeError, ValueError):
            return {}
    return val or {}


def _headers(cfg: dict) -> dict:
    return {
        "Authorization": f"Bearer {cfg.get('api_token') or ''}",
        "Notion-Version": _NOTION_VERSION,
        "Content-Type": "application/json",
    }


def test_connection() -> dict:
    """Connectivity test used by /settings/integrations/notion/test.

    Distinguishes the three real outcomes so the UI can tell the operator what to
    fix: no token / bad token (401) / token valid but nothing shared (0 results).
    """
    import httpx

    cfg = get_notion_cfg()
    token = (cfg.get("api_token") or "").strip()
    if not token:
        return {"ok": False, "message": "api_token is required (Notion internal integration secret)"}

    try:
        with httpx.Client(timeout=20) as client:
            _throttle()
            r = client.post(
                f"{_API}/search",
                headers=_headers(cfg),
                json={"page_size": 1},
            )
        if r.status_code == 401:
            return {"ok": False, "message": "Invalid token (HTTP 401) — check the integration secret"}
        if r.status_code == 400 and "Notion-Version" in r.text:
            return {"ok": False, "message": "Notion rejected the API version header"}
        if r.status_code != 200:
            return {"ok": False, "message": f"HTTP {r.status_code}: {r.text[:160]}"}

        body = r.json()
        results = body.get("results") or []
        if results:
            return {
                "ok": True,
                "message": f"Connected — {len(results)} page(s)/database(s) visible to the integration",
            }
        return {
            "ok": True,
            "message": (
                "Token valid, but no pages are shared with this integration yet. "
                "In Notion open a page → ••• → Connections → add your integration."
            ),
        }
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


# ---------------------------------------------------------------------------
# Block tree → Markdown
# ---------------------------------------------------------------------------

def _rich_text(node: dict) -> str:
    """Join a Notion rich_text array into plain text.

    Notion splits user text into many spans (bold/link/mention boundaries), so a
    single sentence can arrive as 5 array entries — joining is mandatory or the
    body reads like "How to  reset  the  VPN  ?".
    """
    out: list[str] = []
    for span in node.get("rich_text") or []:
        out.append(span.get("plain_text") or "")
    return "".join(out)


def _block_to_md(block: dict) -> str:
    """Convert one Notion block to Markdown ('' when the block has no text)."""
    btype = block.get("type") or ""
    node = block.get(btype) or {}
    text = _rich_text(node)

    if btype == "paragraph":
        return text
    if btype in ("heading_1", "heading_2", "heading_3"):
        level = {"heading_1": "#", "heading_2": "##", "heading_3": "###"}[btype]
        return f"{level} {text}" if text else ""
    if btype == "bulleted_list_item":
        return f"- {text}" if text else ""
    if btype == "numbered_list_item":
        return f"1. {text}" if text else ""
    if btype == "to_do":
        mark = "x" if node.get("checked") else " "
        return f"- [{mark}] {text}" if text else ""
    if btype == "toggle":
        return text
    if btype == "quote":
        return f"> {text}" if text else ""
    if btype == "callout":
        return f"> {text}" if text else ""
    if btype == "code":
        lang = (node.get("language") or "").strip()
        return f"```{lang}\n{text}\n```" if text else ""
    if btype == "divider":
        return "---"
    if btype in ("bookmark", "link_preview"):
        return node.get("url") or ""
    if btype == "equation":
        return node.get("expression") or ""
    if btype == "child_page":
        # The child is fetched as its own article; a heading keeps the parent readable.
        return f"### {node.get('title') or ''}".strip()
    if btype == "table_row":
        cells = [_rich_text({"rich_text": c}) for c in (node.get("cells") or [])]
        return "| " + " | ".join(c.strip() or " " for c in cells) + " |"
    return ""


def _walk_blocks(client, block_id: str, headers: dict, depth: int = 0) -> str:
    """Depth-first render of a block subtree as Markdown.

    Recursion is required: a page's `children` only returns the top level, and any
    block with `has_children` needs its own call. Depth and block counts are capped
    so a pathological document cannot hammer the API.
    """
    if depth > _MAX_BLOCK_DEPTH:
        return ""
    parts: list[str] = []
    cursor: str | None = None
    seen = 0

    while True:
        params: dict = {"page_size": 100}
        if cursor:
            params["start_cursor"] = cursor
        data = _get(f"{_API}/blocks/{block_id}/children", headers, params, client=client)
        if data is None:
            break

        for block in data.get("results") or []:
            seen += 1
            if seen > _MAX_BLOCKS_PER_PAGE:
                logger.info("notion block cap reached for %s", block_id)
                return "\n\n".join(p for p in parts if p)

            md = _block_to_md(block)
            if md:
                parts.append(md)

            # Recurse into children (nested lists, toggles, tables, columns…).
            if block.get("has_children") and block.get("type") != "child_page":
                child_md = _walk_blocks(client, block["id"], headers, depth + 1)
                if child_md:
                    parts.append(child_md)

        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
        if not cursor:
            break

    return "\n\n".join(p for p in parts if p)


# ---------------------------------------------------------------------------
# Page discovery + fetch
# ---------------------------------------------------------------------------

def _page_title(page: dict) -> str:
    """Best-effort title from any of the property shapes Notion returns."""
    for prop in (page.get("properties") or {}).values():
        if prop.get("type") == "title":
            t = _rich_text({"rich_text": prop.get("title") or []})
            if t:
                return t
    # child_page / database rows without a title property
    for key in ("title",):
        node = page.get(key)
        if isinstance(node, list):
            t = _rich_text({"rich_text": node})
            if t:
                return t
    return "Untitled"


def _discover(client, headers: dict, cfg: dict) -> list[dict]:
    """Return the list of Notion page objects to ingest."""
    source_ids = [s.strip() for s in (cfg.get("source_ids") or "").split(",") if s.strip()]
    max_pages = int(cfg.get("max_pages") or 300)

    pages: list[dict] = []

    if source_ids:
        # Explicit IDs win — fetch each one directly (cheaper + predictable).
        for sid in source_ids:
            data = _get(f"{_API}/pages/{sid}", headers, client=client)
            if data and data.get("object") == "page":
                pages.append(data)
                continue
            # A database ID: enumerate its rows.
            rows = _post(f"{_API}/databases/{sid}/query", headers, {"page_size": 100}, client=client)
            if rows:
                pages.extend(
                    r for r in (rows.get("results") or []) if r.get("object") == "page"
                )
            else:
                logger.warning("notion source_id %s is neither a visible page nor a database", sid)
        return pages[:max_pages]

    # No explicit IDs → everything shared with the integration.
    cursor: str | None = None
    while len(pages) < max_pages:
        payload: dict = {"page_size": 100, "filter": {"property": "object", "value": "page"}}
        if cursor:
            payload["start_cursor"] = cursor
        data = _post(f"{_API}/search", headers, payload, client=client)
        if not data:
            break
        pages.extend(r for r in (data.get("results") or []) if r.get("object") == "page")
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
        if not cursor:
            break
    return pages[:max_pages]


def fetch_pages() -> list[dict]:
    """Pull Notion pages as KB article dicts.

    Returns [{page_id, title, domain?, source_url, body}] — the shared loader
    contract consumed by `app/knowledge/loaders.load_all()`.
    """
    import httpx

    cfg = get_notion_cfg()
    if not (cfg.get("api_token") or "").strip():
        return []

    headers = _headers(cfg)
    domain = (cfg.get("domain") or "").strip().lower()
    articles: list[dict] = []

    try:
        with httpx.Client(timeout=40) as client:
            pages = _discover(client, headers, cfg)
            logger.info("notion: %d page(s) discovered", len(pages))

            for page in pages:
                pid = page.get("id")
                if not pid:
                    continue
                title = _page_title(page)
                body = _walk_blocks(client, pid, headers)
                if not body.strip():
                    # Empty page / unsupported block types → skip rather than index a stub.
                    logger.debug("notion page %s produced no text — skipped", pid)
                    continue

                art: dict = {
                    "page_id": f"notion-{pid.replace('-', '')}",
                    "title": title,
                    "source_url": page.get("url") or f"https://www.notion.so/{pid.replace('-', '')}",
                    "body": body,
                }
                if domain:
                    art["domain"] = domain
                # Notion's own edit timestamp feeds the metadata block + audit trail.
                last_edited = page.get("last_edited_time")
                if last_edited:
                    art["meta"] = {"source": "notion", "last_edited": str(last_edited)}
                articles.append(art)
    except Exception as exc:
        logger.warning("notion fetch_pages failed: %s", exc)

    return articles
