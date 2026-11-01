"""Anytype integration — read objects out of a local-first Anytype space into the KB.

Config stored in `system_settings key='anytype'` (JSON):
  { base_url, api_key, space_ids, domain, api_version, max_objects, object_types }

  base_url     — where the Anytype API answers. Desktop app: http://127.0.0.1:31009.
                 anytype-cli runs on 31012. A container must reach the host, not loopback.
  api_key      — created in Anytype → Settings → API Keys
  space_ids    — optional comma list of space IDs to restrict the crawl.
                 Empty = every space the key can see.
  domain       — KB domain tag; empty → auto-classified from title/body
  api_version  — value of the required `Anytype-Version` header (default 2025-11-08)
  max_objects  — safety ceiling on objects fetched per sync (default 300)
  object_types — optional comma list of type keys to fetch, e.g. "page,note".
                 Empty = every object in the space.

VERIFIED AGAINST THE PUBLISHED API (v1):
  GET {base}/v1/spaces                       — list spaces
  GET {base}/v1/spaces/{space}/objects       — list objects (offset / limit)
  GET {base}/v1/spaces/{space}/objects/{id}  — one object, with its blocks

TWO ANYTYPE-SPECIFIC TRAPS this module handles explicitly:

1. THE VERSION HEADER IS MANDATORY. Every request needs BOTH
   `Authorization: Bearer <key>` and `Anytype-Version: <date>`. A request missing the
   version header is rejected, so it is always sent — from config when set, otherwise
   the dated default below. `test_connection()` reports the two failures separately
   (401 = key rejected, 400 = version header missing or unsupported) because the fix
   for each is different and "it did not work" is not actionable.

2. THE BLOCK SCHEMA IS NOT PINNED. The reference says an object's `blocks` "may
   include text, files, properties and dataviews" without fixing the shape. So the
   converter reads the text it recognises and SKIPS the rest. An unknown block is
   never emitted as an empty stub, and an object whose body comes out blank is not
   indexed at all — a blank article in the knowledge base is worse than a missing
   one, because it can be retrieved and cited as if it were an answer.

Nothing here writes to Anytype: this module only ever issues GETs.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import text

from app.persistence.database import SessionLocal

logger = logging.getLogger("integrations.anytype")

_INTEGRATION_KEY = "anytype"
_DEFAULT_BASE = "http://127.0.0.1:31009"
# Date-based API versioning, as Anytype ships it. Overridable per deployment.
_DEFAULT_VERSION = "2025-11-08"
_PAGE_LIMIT = 100          # objects per listing request
_MAX_BLOCK_DEPTH = 6       # guard against pathological nesting
_MAX_BLOCKS_PER_OBJECT = 600


def get_anytype_cfg() -> dict:
    """Read Anytype config from system_settings (JSON string or dict)."""
    try:
        with SessionLocal() as s:
            row = s.execute(
                text("SELECT value FROM system_settings WHERE key = :k"),
                {"k": _INTEGRATION_KEY},
            ).first()
    except Exception as exc:
        logger.warning("anytype cfg read failed: %s", exc)
        return {}
    val = row[0] if row else {}
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except (TypeError, ValueError):
            return {}
    return val or {}


def _base(cfg: dict) -> str:
    return (cfg.get("base_url") or _DEFAULT_BASE).strip().rstrip("/")


def _headers(cfg: dict) -> dict:
    """Both headers are mandatory — see trap 1 in the module docstring."""
    return {
        "Authorization": f"Bearer {(cfg.get('api_key') or '').strip()}",
        "Anytype-Version": (cfg.get("api_version") or _DEFAULT_VERSION).strip(),
        "Content-Type": "application/json",
    }


def _get(client, cfg: dict, path: str, params: dict | None = None) -> dict | None:
    """GET one Anytype endpoint, returning parsed JSON or None on any failure."""
    url = f"{_base(cfg)}{path}"
    try:
        r = client.get(url, headers=_headers(cfg), params=params or {})
    except Exception as exc:
        logger.warning("anytype GET %s failed: %s", path, exc)
        return None
    if r.status_code != 200:
        # The body carries the API's own code/message; keeping it makes a 400 from a
        # missing version header distinguishable from a 401 bad key in the logs.
        logger.warning("anytype GET %s -> HTTP %s: %s", path, r.status_code, r.text[:200])
        return None
    try:
        return r.json()
    except ValueError:
        logger.warning("anytype GET %s returned non-JSON", path)
        return None


def _items(payload) -> list[dict]:
    """Pull the list out of a listing response, whatever wrapper it uses."""
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in ("data", "items", "objects", "spaces", "results"):
            val = payload.get(key)
            if isinstance(val, list):
                return [x for x in val if isinstance(x, dict)]
    return []


def _text_of(node) -> str:
    """Best-effort text from a text/block node — recognised shapes only."""
    if isinstance(node, str):
        return node
    if not isinstance(node, dict):
        return ""
    # Anytype wraps rich text as {"text": {"text": "..."}} in the shapes seen so far,
    # but a plain {"text": "..."} is just as plausible, so both are accepted.
    inner = node.get("text")
    if isinstance(inner, str):
        return inner
    if isinstance(inner, dict):
        got = inner.get("text") or inner.get("content")
        if isinstance(got, str):
            return got
    for key in ("content", "name", "title"):
        val = node.get(key)
        if isinstance(val, str):
            return val
    return ""


def _block_md(block: dict, depth: int = 0, budget: list[int] | None = None) -> str:
    """Convert one block (and its children) to markdown. Unknown shapes are skipped."""
    if budget is None:
        budget = [_MAX_BLOCKS_PER_OBJECT]
    if budget[0] <= 0 or depth > _MAX_BLOCK_DEPTH:
        return ""
    budget[0] -= 1

    style = str(block.get("style") or block.get("type") or "").strip().lower()
    text = _text_of(block).strip()
    lines: list[str] = []

    if text:
        if style in ("header1", "h1", "title"):
            lines.append(f"# {text}")
        elif style in ("header2", "h2"):
            lines.append(f"## {text}")
        elif style in ("header3", "h3"):
            lines.append(f"### {text}")
        elif style in ("bullet", "bulleted", "bulletedlist"):
            lines.append(f"- {text}")
        elif style in ("numbered", "number", "numberedlist"):
            lines.append(f"1. {text}")
        elif style in ("quote", "blockquote"):
            lines.append(f"> {text}")
        elif style in ("code", "codeblock"):
            lines.append(f"```\n{text}\n```")
        elif style in ("checkbox", "todo", "toggle"):
            lines.append(f"- [ ] {text}")
        else:
            lines.append(text)

    for child in block.get("children") or []:
        if isinstance(child, dict):
            lines.append(_block_md(child, depth + 1, budget))

    return "\n\n".join(x for x in lines if x.strip())


def _body_from(obj: dict) -> str:
    """Flatten an object's blocks into markdown."""
    blocks = obj.get("blocks")
    if isinstance(blocks, list):
        budget = [_MAX_BLOCKS_PER_OBJECT]
        parts = [_block_md(b, 0, budget) for b in blocks if isinstance(b, dict)]
        body = "\n\n".join(p for p in parts if p.strip())
        if body.strip():
            return body
    # Some responses carry the text directly. Falling back keeps the integration
    # useful against an API revision that reshapes `blocks`, and costs nothing when
    # the blocks path already produced text.
    for key in ("markdown", "body", "snippet", "text"):
        val = obj.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _object_name(obj: dict) -> str:
    name = obj.get("name") or obj.get("title")
    if isinstance(name, str) and name.strip():
        return name.strip()
    # Anytype renders a name from `name` or an emoji/image `icon`; an object with
    # neither is still worth ingesting under its ID rather than dropped.
    return f"Untitled ({obj.get('id') or 'object'})"


def test_connection() -> dict:
    """Connectivity test used by /settings/integrations/anytype/test.

    Separates the outcomes an operator can actually act on:
      no key      → nothing to try
      key/base missing → ValueError surfaces as 400 in the API layer
      401/403     → the key is wrong or revoked
      400/other   → the API answered but refused the request (usually the
                    Anytype-Version header), reported with the body
      200 + spaces → ok, and the space count is returned as evidence
    """
    import httpx

    cfg = get_anytype_cfg()
    key = (cfg.get("api_key") or "").strip()
    if not key:
        return {"ok": False, "message": "api_key not set — create a key in Anytype "
                                        "(Settings → API Keys), paste it and Save first"}

    base = _base(cfg)
    version = (cfg.get("api_version") or _DEFAULT_VERSION).strip()
    try:
        with httpx.Client(timeout=15) as client:
            r = client.get(f"{base}/v1/spaces", headers=_headers(cfg), params={"limit": 100})
    except Exception as exc:
        return {"ok": False, "message": f"cannot reach {base}: {type(exc).__name__}: {exc}"}

    if r.status_code in (401, 403):
        return {"ok": False, "message": f"API key rejected (HTTP {r.status_code}). "
                                        "Create a fresh key in Anytype and save it here."}
    if r.status_code != 200:
        return {"ok": False, "message": f"HTTP {r.status_code} from {base}/v1/spaces — "
                                        f"check that Anytype is running and that "
                                        f"Anytype-Version={version} is supported. "
                                        f"{r.text[:160]}"}

    spaces = _items(r.json())
    if not spaces:
        return {"ok": True, "message": f"connected to {base}, but the key sees no spaces "
                                       f"(create one in Anytype, or the key belongs to "
                                       f"another account)", "spaces": 0}
    names = [str(s.get("name") or s.get("id") or "?") for s in spaces[:5]]
    return {"ok": True, "message": f"connected — {len(spaces)} space(s) visible: "
                                   f"{', '.join(names)}", "spaces": len(spaces)}


def fetch_pages() -> list[dict]:
    """Pull Anytype objects as KB article dicts.

    Returns [{page_id, title, domain?, source_url, body, meta?}] — the shared loader
    contract consumed by `app/knowledge/loaders.load_all()`.
    """
    import httpx

    cfg = get_anytype_cfg()
    if not (cfg.get("api_key") or "").strip():
        return []

    domain = (cfg.get("domain") or "").strip().lower()
    try:
        max_objects = int(str(cfg.get("max_objects") or "300").strip() or 300)
    except ValueError:
        max_objects = 300
    wanted_types = {
        t.strip().lower()
        for t in str(cfg.get("object_types") or "").split(",")
        if t.strip()
    }
    wanted_spaces = {
        s.strip() for s in str(cfg.get("space_ids") or "").split(",") if s.strip()
    }

    articles: list[dict] = []

    try:
        with httpx.Client(timeout=40) as client:
            spaces = _items(_get(client, cfg, "/v1/spaces", {"limit": 100}))
            if wanted_spaces:
                spaces = [
                    s for s in spaces
                    if str(s.get("id") or "") in wanted_spaces
                    or str(s.get("name") or "") in wanted_spaces
                ]
            logger.info("anytype: %d space(s) to scan", len(spaces))

            for space in spaces:
                sid = str(space.get("id") or "").strip()
                if not sid:
                    continue
                space_name = str(space.get("name") or sid)

                offset = 0
                while len(articles) < max_objects:
                    listing = _get(
                        client, cfg, f"/v1/spaces/{sid}/objects",
                        {"limit": _PAGE_LIMIT, "offset": offset},
                    )
                    batch = _items(listing)
                    if not batch:
                        break

                    for obj in batch:
                        if len(articles) >= max_objects:
                            break
                        oid = str(obj.get("id") or "").strip()
                        if not oid:
                            continue
                        if wanted_types:
                            otype = str(
                                obj.get("type_key")
                                or (obj.get("type") or {}).get("key")
                                or obj.get("type")
                                or ""
                            ).lower()
                            if otype not in wanted_types:
                                continue

                        # The listing carries a snippet but not the blocks; the body
                        # needs the per-object read.
                        full = _get(client, cfg, f"/v1/spaces/{sid}/objects/{oid}") or obj
                        body = _body_from(full)
                        if not body.strip():
                            logger.debug("anytype object %s produced no text — skipped", oid)
                            continue

                        art: dict = {
                            "page_id": f"anytype-{oid}",
                            "title": _object_name(full),
                            "source_url": f"{_base(cfg)}/v1/spaces/{sid}/objects/{oid}",
                            "body": body,
                        }
                        if domain:
                            art["domain"] = domain
                        art["meta"] = {
                            "source": "anytype",
                            "space": space_name,
                            "space_id": sid,
                        }
                        articles.append(art)

                    if len(batch) < _PAGE_LIMIT:
                        break
                    offset += _PAGE_LIMIT
    except Exception as exc:
        logger.warning("anytype fetch_pages failed: %s", exc)

    logger.info("anytype: %d object(s) fetched", len(articles))
    return articles
