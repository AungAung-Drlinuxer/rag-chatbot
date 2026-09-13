"""ClickUp integration — REST API client for KB ingestion (cloud SaaS).

Config stored in `system_settings key='clickup'` (JSON):
  { api_token, list_ids, doc_ids, workspace_ids, include_comments,
    domain, min_chars, max_tasks }

  api_token        — ClickUp *personal* API token (pk_...)
  list_ids         — REAL List IDs (not the workspace id!), comma separated.
                     Required for task ingestion; tasks are only read from these.
  doc_ids          — optional comma list of Doc IDs. EMPTY = every doc in the
                     workspace (the Docs API is workspace-scoped).
  workspace_ids    — optional; the first workspace the token can see is used otherwise
  include_comments — "1"/"true" to fold task comments into the body (default off)
  domain           — KB domain tag; empty → auto-classified. Must be a real
                     pipeline domain (e.g. "general") or the content is invisible
                     to role-scoped users.
  min_chars        — skip tasks whose text is shorter than this (default 120)
  max_tasks        — safety ceiling per sync (default 500)

Docs API note (v1.6.41): the documented /api/v3/docs/{id}/pages and /api/v2/doc/{id}
routes return '404 page not found'. The working, workspace-scoped routes are:
    GET /api/v3/workspaces/{ws}/docs
    GET /api/v3/workspaces/{ws}/docs/{doc}/pages
    GET /api/v3/workspaces/{ws}/docs/{doc}/pages/{page}   (content lives in .content)

Auth: ClickUp wants the raw token in `Authorization` — **no `Bearer ` prefix**.
That is a common foot-gun; a prefixed token returns 401 with a misleading body.

WHY TASKS ARE FILTERED BY LIST: a ClickUp workspace is full of operational noise
("thanks!", "done", "+1"). Indexing all of it pollutes retrieval and buries the
real documentation. Tasks are therefore only ingested from lists you name
explicitly, and short entries are dropped via `min_chars`. The Docs surface is the
better KB source where it is available.

TASK METADATA: status / priority / assignees / due date / tags are written BOTH
into a leading metadata block in the body (so they are semantically searchable and
visible in citations) AND into chunk `cmetadata` (so they can be filtered on).
"""
from __future__ import annotations

import json
import logging
import threading
import time

from sqlalchemy import text

from app.persistence.database import SessionLocal

logger = logging.getLogger("integrations.clickup")

_INTEGRATION_KEY = "clickup"
_API = "https://api.clickup.com/api/v2"
_API_V3 = "https://api.clickup.com/api/v3"

# ClickUp free tier allows 100 req/min; unlimited tiers allow 10k/min. 6 req/s
# keeps us comfortably inside the free allowance for any plan.
_RATE_LOCK = threading.Lock()
_LAST_CALL = [0.0]
_MIN_INTERVAL = 0.17


def _throttle() -> None:
    with _RATE_LOCK:
        delta = time.monotonic() - _LAST_CALL[0]
        if delta < _MIN_INTERVAL:
            time.sleep(_MIN_INTERVAL - delta)
        _LAST_CALL[0] = time.monotonic()


def _headers(cfg: dict) -> dict:
    # NOTE: deliberately no "Bearer " prefix — ClickUp rejects a prefixed token.
    return {
        "Authorization": (cfg.get("api_token") or "").strip(),
        "Content-Type": "application/json",
    }


def _get(url: str, headers: dict, params: dict | None = None, *, client) -> dict | None:
    """GET with throttle + 429 backoff. Returns parsed JSON, or None."""
    for attempt in range(4):
        _throttle()
        try:
            r = client.get(url, headers=headers, params=params)
        except Exception as exc:
            logger.warning("clickup GET failed (%s): %s", url, exc)
            return None
        if r.status_code == 200:
            try:
                return r.json()
            except ValueError:
                return None
        if r.status_code == 429:
            wait = float(r.headers.get("Retry-After") or 2.0)
            logger.info("clickup 429 — backing off %.1fs", wait)
            time.sleep(min(wait, 20.0))
            continue
        if 500 <= r.status_code < 600 and attempt < 3:
            time.sleep(1.5 * (attempt + 1))
            continue
        logger.warning("clickup GET %s -> HTTP %s", url, r.status_code)
        return None
    return None


def get_clickup_cfg() -> dict:
    """Read ClickUp config from system_settings (JSON string or dict)."""
    try:
        with SessionLocal() as s:
            row = s.execute(
                text("SELECT value FROM system_settings WHERE key = :k"),
                {"k": _INTEGRATION_KEY},
            ).first()
    except Exception as exc:
        logger.warning("clickup cfg read failed: %s", exc)
        return {}
    val = row[0] if row else {}
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except (TypeError, ValueError):
            return {}
    return val or {}


def _enabled(cfg: dict, key: str, default: bool = False) -> bool:
    raw = str(cfg.get(key) if cfg.get(key) is not None else ("1" if default else "0")).strip().lower()
    return raw in ("1", "true", "yes", "on")


def _csv(cfg: dict, key: str) -> list[str]:
    return [s.strip() for s in (cfg.get(key) or "").split(",") if s.strip()]


def test_connection() -> dict:
    """Connectivity test used by /settings/integrations/clickup/test."""
    import httpx

    cfg = get_clickup_cfg()
    if not (cfg.get("api_token") or "").strip():
        return {"ok": False, "message": "api_token is required (ClickUp personal token, pk_...)"}
    if (cfg.get("api_token") or "").strip().lower().startswith("bearer "):
        return {
            "ok": False,
            "message": "Remove the 'Bearer ' prefix — ClickUp expects the raw pk_... token",
        }

    try:
        with httpx.Client(timeout=20) as client:
            data = _get(f"{_API}/user", _headers(cfg), client=client)
        if data is None:
            return {"ok": False, "message": "Request failed — check the token (HTTP 401 returns no body)"}
        user = data.get("user") or {}
        name = user.get("username") or user.get("email") or "unknown"

        # v1.6.41 — also report what is actually reachable, because a valid token
        # with a wrong List/Doc id syncs NOTHING while the connection test still
        # passes. This turns a silent no-op into an obvious message.
        detail_bits: list[str] = []
        with httpx.Client(timeout=25) as client:
            wsid = _workspace_id(cfg, _headers(cfg), client)
            if wsid:
                docs = _list_docs(wsid, _headers(cfg), client)
                detail_bits.append(f"{len(docs)} doc(s)")
            if cfg.get("list_ids"):
                for lid in _csv(cfg, "list_ids"):
                    rl = client.get(f"{_API}/list/{lid}/task", headers=_headers(cfg),
                                    params={"page": 0})
                    detail_bits.append(
                        f"list {lid}: {'OK' if rl.status_code == 200 else f'HTTP {rl.status_code}'}"
                    )
            else:
                detail_bits.append("no list_ids (tasks will not sync)")

        tail = " · ".join(detail_bits) if detail_bits else ""
        return {"ok": True, "message": f"Connected as {name}" + (f" — {tail}" if tail else "")}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


# ---------------------------------------------------------------------------
# Text rendering + metadata
# ---------------------------------------------------------------------------

_PRIORITY = {1: "Urgent", 2: "High", 3: "Normal", 4: "Low"}


def _task_meta_block(task: dict) -> tuple[str, dict]:
    """Build the searchable metadata header + the cmetadata payload for a task."""
    status = ((task.get("status") or {}).get("status") or "").strip()
    prio_raw = (task.get("priority") or {}).get("priority")
    priority = _PRIORITY.get(prio_raw if isinstance(prio_raw, int) else None, "") if prio_raw else ""
    assignees = ", ".join(
        (a.get("username") or a.get("email") or "") for a in (task.get("assignees") or [])
    ).strip(", ")
    tags = ", ".join((t.get("name") or "") for t in (task.get("tags") or [])).strip(", ")
    due = task.get("due_date")
    due_str = ""
    if due and str(due).isdigit():
        try:
            due_str = time.strftime("%Y-%m-%d", time.localtime(int(due) / 1000))
        except (ValueError, OSError):
            due_str = ""

    lines = ["| Field | Value |", "| --- | --- |"]
    for label, value in (
        ("Task ID", task.get("id") or ""),
        ("Status", status),
        ("Priority", priority),
        ("Assignees", assignees),
        ("Tags", tags),
        ("Due date", due_str),
        ("List", (task.get("list") or {}).get("name") or ""),
        ("Space", (task.get("space") or {}).get("id") or ""),
    ):
        if value:
            lines.append(f"| {label} | {value} |")

    meta = {
        "source": "clickup",
        "clickup_status": status,
        "clickup_priority": priority or "none",
        "clickup_assignees": assignees,
        "clickup_tags": tags,
        "clickup_list": (task.get("list") or {}).get("name") or "",
    }
    return "\n".join(lines), meta


def _task_body(task: dict, comments: list[dict] | None) -> str:
    """Task text: description, then comments (optional), prefixed by metadata."""
    header, _ = _task_meta_block(task)
    desc = (task.get("text_content") or task.get("description") or "").strip()
    parts = [header]
    if desc:
        parts.append(desc)
    if comments:
        lines = ["> **Comments**", ""]
        for c in comments:
            who = ((c.get("user") or {}).get("username") or "").strip()
            txt = (c.get("text") or c.get("comment_text") or "").strip()
            if txt:
                lines.append(f"- **{who or 'user'}**: {txt}")
        if len(lines) > 2:
            parts.append("\n".join(lines))
    return "\n\n".join(p for p in parts if p)


# ---------------------------------------------------------------------------
# Fetch: tasks
# ---------------------------------------------------------------------------

def _fetch_tasks(client, cfg: dict, headers: dict) -> list[dict]:
    list_ids = _csv(cfg, "list_ids")
    if not list_ids:
        return []
    max_tasks = int(cfg.get("max_tasks") or 500)
    min_chars = int(cfg.get("min_chars") or 120)
    want_comments = _enabled(cfg, "include_comments", False)
    domain = (cfg.get("domain") or "").strip().lower()

    articles: list[dict] = []
    for list_id in list_ids:
        page = 0
        while len(articles) < max_tasks:
            data = _get(
                f"{_API}/list/{list_id}/task",
                headers,
                {"include_closed": "true", "subtasks": "true", "page": page},
                client=client,
            )
            if not data:
                break
            tasks = data.get("tasks") or []
            if not tasks:
                break

            for task in tasks:
                if len(articles) >= max_tasks:
                    break
                tid = task.get("id")
                if not tid:
                    continue

                comments: list[dict] = []
                if want_comments:
                    cdata = _get(f"{_API}/task/{tid}/comment", headers, client=client)
                    comments = (cdata or {}).get("comments") or []

                body = _task_body(task, comments)
                if len(body) < min_chars:
                    # Operational chatter ("thanks!", "done") is not documentation.
                    continue

                _, meta = _task_meta_block(task)
                art: dict = {
                    "page_id": f"clickup-{tid}",
                    "title": (task.get("name") or f"ClickUp task {tid}").strip(),
                    "source_url": task.get("url") or f"https://app.clickup.com/t/{tid}",
                    "body": body,
                    "meta": meta,
                }
                if domain:
                    art["domain"] = domain
                articles.append(art)

            if len(tasks) < 100:
                break
            page += 1

    return articles


# ---------------------------------------------------------------------------
# Fetch: docs (plan-gated — failures are logged, never fatal)
# ---------------------------------------------------------------------------

def _workspace_id(cfg: dict, headers: dict, client) -> str | None:
    """Resolve the ClickUp workspace (team) id.

    The Docs API is workspace-scoped, and a `pk_...` token can span several
    workspaces, so `workspace_ids` may name one explicitly; otherwise the first
    workspace the token can see is used.
    """
    explicit = _csv(cfg, "workspace_ids")
    if explicit:
        return explicit[0]
    data = _get(f"{_API}/team", headers, client=client)
    teams = (data or {}).get("teams") or []
    return str(teams[0]["id"]) if teams else None


def _list_docs(workspace_id: str, headers: dict, client) -> list[dict]:
    """All ClickUp Docs in a workspace (v3, paginated)."""
    out: list[dict] = []
    page = 0
    while page < 20:  # ceiling: 20 * 100 docs
        data = _get(
            f"{_API_V3}/workspaces/{workspace_id}/docs",
            headers,
            {"page": page},
            client=client,
        )
        if not data:
            break
        docs = data.get("docs") or []
        if not docs:
            break
        out.extend(docs)
        if len(docs) < 100:
            break
        page += 1
    return out


def _fetch_docs(client, cfg: dict, headers: dict) -> list[dict]:
    doc_ids = _csv(cfg, "doc_ids")
    domain = (cfg.get("domain") or "").strip().lower()
    articles: list[dict] = []

    # v1.6.41 — the Docs API is WORKSPACE-scoped. The previous paths
    # (/api/v3/docs/{id}/pages, /api/v2/doc/{id}) both return
    # '404 page not found'; the working routes are
    #   GET /api/v3/workspaces/{ws}/docs                -> all docs
    #   GET /api/v3/workspaces/{ws}/docs/{doc}/pages    -> pages of a doc
    #   GET /api/v3/workspaces/{ws}/docs/{doc}/pages/{page}
    ws = _workspace_id(cfg, headers, client)
    if not ws:
        logger.info("clickup: no workspace id resolvable — docs skipped")
        return []

    docs = _list_docs(ws, headers, client)
    if doc_ids:
        wanted = set(doc_ids)
        docs = [d for d in docs if str(d.get("id")) in wanted] or [
            {"id": d, "name": d} for d in doc_ids
        ]
    if not docs:
        logger.info("clickup: no docs available for workspace %s", ws)
    for doc in docs:
        doc_id = doc.get("id")
        if not doc_id:
            continue
        pages = _get(f"{_API_V3}/workspaces/{ws}/docs/{doc_id}/pages", headers, client=client)
        if pages is None:
            logger.info("clickup doc %s unavailable — skipped", doc_id)
            continue
        if isinstance(pages, dict):
            pages = pages.get("pages") or pages.get("data") or []
        for pg in pages:
            pid = pg.get("id")
            name = (pg.get("name") or pg.get("title") or "").strip()
            if not pid:
                continue
            detail = _get(
                f"{_API_V3}/workspaces/{ws}/docs/{doc_id}/pages/{pid}", headers, client=client
            )
            content = ""
            if detail:
                node = detail.get("page") or detail
                content = node.get("content") or node.get("text") or ""
            if not content.strip():
                # A page with an empty body carries no knowledge — skip it rather
                # than indexing a title-only stub.
                continue
            art: dict = {
                "page_id": f"clickup-doc-{doc_id}-{pid}",
                "title": name or (doc.get("name") or f"ClickUp doc {doc_id}"),
                "source_url": f"https://app.clickup.com/{ws}/v/dc/{doc_id}/{pid}",
                "body": content,
                "meta": {"source": "clickup", "clickup_kind": "doc",
                         "clickup_doc": (doc.get("name") or doc_id)},
            }
            if domain:
                art["domain"] = domain
            articles.append(art)

    return articles


def fetch_pages() -> list[dict]:
    """Pull ClickUp Docs + designated List tasks as KB article dicts.

    Returns [{page_id, title, domain?, source_url, body, meta?}] — the shared
    loader contract consumed by `app/knowledge/loaders.load_all()`.
    """
    import httpx

    cfg = get_clickup_cfg()
    if not (cfg.get("api_token") or "").strip():
        return []

    headers = _headers(cfg)
    articles: list[dict] = []

    try:
        with httpx.Client(timeout=40) as client:
            try:
                articles.extend(_fetch_docs(client, cfg, headers))
            except Exception as exc:
                logger.warning("clickup docs fetch failed: %s", exc)
            try:
                articles.extend(_fetch_tasks(client, cfg, headers))
            except Exception as exc:
                logger.warning("clickup tasks fetch failed: %s", exc)
    except Exception as exc:
        logger.warning("clickup fetch_pages failed: %s", exc)

    return articles
