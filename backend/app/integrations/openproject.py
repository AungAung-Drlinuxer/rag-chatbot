"""OpenProject integration — API v3 client (work packages + wiki pages).

Design (mirrors confluence.py pattern):
- settings stored in `system_settings key='openproject'` (JSON):
  { base_url, api_key, project_id, wiki_enabled }
- api_key missing -> safe no-op (empty results), never raise
- API key goes in Basic auth as username `apikey` (OpenProject standard)
"""
from __future__ import annotations

import logging

from app.persistence.database import SessionLocal
from sqlalchemy import text

logger = logging.getLogger("integrations.openproject")

_INTEGRATION_KEY = "openproject"


def get_op_cfg() -> dict:
    """Read OpenProject config from system_settings (JSON string or dict)."""
    import json as _json

    try:
        with SessionLocal() as s:
            row = s.execute(
                text("SELECT value FROM system_settings WHERE key = :k"),
                {"k": _INTEGRATION_KEY},
            ).first()
    except Exception as exc:  # DB not ready — never crash the chat path
        logger.warning("openproject cfg read failed: %s", exc)
        return {}
    val = row[0] if row else {}
    if isinstance(val, str):
        try:
            val = _json.loads(val)
        except (TypeError, ValueError):
            return {}
    return val or {}


def test_connection() -> dict:
    """Connectivity test used by /settings/integrations/openproject/test."""
    import httpx

    cfg = get_op_cfg()
    base = (cfg.get("base_url") or "").rstrip("/")
    key = cfg.get("api_key") or ""
    if not base or not key:
        return {"ok": False, "message": "base_url and api_key are required"}
    try:
        r = httpx.get(
            f"{base}/api/v3/projects/{cfg.get('project_id') or ''}".rstrip("/"),
            auth=("apikey", key),
            headers={"Accept": "application/hal+json"},
            timeout=15,
        )
        if r.status_code == 200:
            name = r.json().get("name", "")
            return {"ok": True, "message": f"Connected to project '{name}'"}
        return {"ok": False, "message": f"HTTP {r.status_code}: {r.text[:120]}"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


# ---------------------------------------------------------------- creation
def create_issue(summary: str, description: str = "",
                 priority: str | None = None, project_id: str | None = None) -> dict:
    """OpenProject ticket creation — POST /api/v3/projects/:id/work_packages.

    Returns {op_key, link, mode} shaped like jira.escalate() so the tickets API
    can treat both destinations uniformly. mode: 'rest' on success,
    'link' when not configured/unreachable (pre-filled web form URL).
    """
    import httpx

    cfg = get_op_cfg()
    base = (cfg.get("base_url") or "").rstrip("/")
    key = cfg.get("api_key") or ""
    pid = str(project_id or cfg.get("project_id") or "").strip()
    if not (base and key and pid):
        return {"op_key": None, "link": f"{base}/work_packages/new", "mode": "link"}

    payload: dict = {
        "_links": {
            "project": {"href": f"/api/v3/projects/{pid}"},
            "type": {"href": "/api/v3/types/1"},  # 1 = "Task" in stock OP
        },
        "subject": summary[:255],
        "description": {"raw": description or ""},
    }
    # v1.6.9 — pin the canonical status explicitly (default status of a fresh
    # work package depends on the project type; make it deterministic).
    from app.integrations.ticket_status import op_status_id_for
    sid = op_status_id_for("open")
    if sid is not None:
        payload["_links"]["status"] = {"href": f"/api/v3/statuses/{sid}"}
    prio_map = {"low": "5", "medium": "6", "high": "7", "critical": "8"}
    p_href = prio_map.get((priority or "").lower())
    if p_href:
        payload["_links"]["priority"] = {"href": f"/api/v3/priorities/{p_href}"}

    try:
        with httpx.Client(timeout=30, auth=("apikey", key),
                          headers={"Accept": "application/hal+json",
                                   "Content-Type": "application/json"}) as client:
            r = client.post(f"{base}/api/v3/projects/{pid}/work_packages", json=payload)
            if r.status_code not in (200, 201):
                return {"op_key": None, "link": f"{base}/work_packages/new",
                        "mode": "link", "error": f"HTTP {r.status_code}: {r.text[:160]}"}
            body = r.json()
        wp_id = body.get("id")
        return {"op_key": f"OP-{wp_id}",
                "link": f"{base}/work_packages/{wp_id}",
                "mode": "rest"}
    except Exception as exc:
        return {"op_key": None, "link": f"{base}/work_packages/new",
                "mode": "link", "error": f"{type(exc).__name__}: {exc}"}


# v1.6.9 — canonical status transitions on OpenProject work packages
def update_status(op_key: str, canonical: str) -> dict:
    """Move an OP work package to the status matching a canonical platform status.

    op_key: 'OP-<id>' (as stored in jira_tickets.jira_key).
    Returns {ok, detail}.
    """
    import httpx

    cfg = get_op_cfg()
    base = (cfg.get("base_url") or "").rstrip("/")
    key = cfg.get("api_key") or ""
    wp_id = op_key.replace("OP-", "").strip()
    if not (base and key and wp_id.isdigit()):
        return {"ok": False, "detail": "OpenProject not configured or bad key"}

    from app.integrations.ticket_status import op_status_id_for
    sid = op_status_id_for(canonical)
    if sid is None:
        return {"ok": False, "detail": f"no OP status for '{canonical}'"}

    try:
        with httpx.Client(timeout=30, auth=("apikey", key),
                          headers={"Accept": "application/hal+json",
                                   "Content-Type": "application/json"}) as client:
            lock_version = None
            # OP work packages are PATCHed with lock_version for optimistic locking
            r0 = client.get(f"{base}/api/v3/work_packages/{wp_id}")
            if r0.status_code == 200:
                lock_version = r0.json().get("lockVersion")
            payload: dict = {"_links": {"status": {"href": f"/api/v3/statuses/{sid}"}}}
            if lock_version is not None:
                payload["lockVersion"] = lock_version
            r = client.patch(f"{base}/api/v3/work_packages/{wp_id}", json=payload)
            if r.status_code not in (200, 204):
                return {"ok": False, "detail": f"HTTP {r.status_code}: {r.text[:160]}"}
        return {"ok": True, "detail": f"OP status set to {canonical} (statuses/{sid})"}
    except Exception as exc:
        return {"ok": False, "detail": f"{type(exc).__name__}: {exc}"}


# ---------------------------------------------------------------- work packages
def fetch_work_packages(limit: int = 200) -> list[dict]:
    """Pull open work packages for the configured project.

    Returns normalized ticket dicts:
      {ticket_id ('op-<id>'), title, body, status, ticket_type, assignee,
       source_url, created_at, updated_at, source='openproject'}
    """
    import httpx

    cfg = get_op_cfg()
    base = (cfg.get("base_url") or "").rstrip("/")
    key = cfg.get("api_key") or ""
    pid = cfg.get("project_id") or ""
    if not base or not key or not pid:
        return []

    out: list[dict] = []
    url = f"{base}/api/v3/projects/{pid}/work_packages?pageSize={min(limit, 1000)}"
    try:
        with httpx.Client(timeout=30, auth=("apikey", key),
                          headers={"Accept": "application/hal+json"}) as client:
            while url:
                r = client.get(url)
                if r.status_code != 200:
                    logger.warning("openproject work_packages HTTP %s", r.status_code)
                    break
                data = r.json()
                for wp in data.get("_embedded", {}).get("elements", []):
                    status = (wp.get("_links", {}).get("status", {}) or {}).get("title", "")
                    ttype = (wp.get("_links", {}).get("type", {}) or {}).get("title", "")
                    assignee = (wp.get("_links", {}).get("assignee", {}) or {}).get("title", "")
                    wp_id = wp.get("id")
                    out.append({
                        "ticket_id": f"op-{wp_id}",
                        "title": wp.get("subject", ""),
                        "body": wp.get("description", {}).get("raw", "") if isinstance(wp.get("description"), dict) else (wp.get("description") or ""),
                        "status": (status or "").lower(),
                        "ticket_type": ttype or "task",
                        "assignee": assignee or "",
                        "source_url": f"{base}/work_packages/{wp_id}/activity",
                        "created_at": wp.get("createdAt"),
                        "updated_at": wp.get("updatedAt"),
                        "source": "openproject",
                    })
                url = None  # single page is enough for sync (pageSize up to 1000)
    except Exception as exc:
        logger.warning("openproject fetch_work_packages failed: %s", exc)
    return out


# ---------------------------------------------------------------- wiki pages
def fetch_wiki_pages() -> list[dict]:
    """Pull wiki pages as KB article dicts (same shape as Confluence loader).

    Returns: [{page_id ('opwiki-<id>'), title, body(html->text), source_url}]
    """
    import httpx

    cfg = get_op_cfg()
    if not cfg.get("wiki_enabled"):
        return []
    base = (cfg.get("base_url") or "").rstrip("/")
    key = cfg.get("api_key") or ""
    pid = cfg.get("project_id") or ""
    if not base or not key or not pid:
        return []

    articles: list[dict] = []

    def _strip_html(html: str) -> str:
        import re

        text = re.sub(r"<[^>]+>", " ", html or "")
        return re.sub(r"\s+", " ", text).strip()

    try:
        with httpx.Client(timeout=30, auth=("apikey", key),
                          headers={"Accept": "application/hal+json"}) as client:
            # 1) find the project's wiki home
            r = client.get(f"{base}/api/v3/projects/{pid}/wiki")
            if r.status_code != 200:
                logger.info("openproject wiki not enabled for project %s", pid)
                return []
            # 2) list wiki pages (paginated)
            url = f"{base}/api/v3/projects/{pid}/wiki/pages?pageSize=100"
            while url:
                rp = client.get(url)
                if rp.status_code != 200:
                    break
                data = rp.json()
                for page in data.get("_embedded", {}).get("elements", []):
                    page_id = page.get("id")
                    title = page.get("title", "")
                    # 3) fetch full page content
                    rc = client.get(f"{base}/api/v3/wiki_pages/{page_id}")
                    body = ""
                    if rc.status_code == 200:
                        raw = rc.json().get("body", {})
                        html = raw.get("html", "") if isinstance(raw, dict) else ""
                        body = _strip_html(html)
                    if body:
                        articles.append({
                            "page_id": f"opwiki-{page_id}",
                            "title": title,
                            "source_url": f"{base}/projects/{pid}/wiki/{page_id}",
                            "body": body,
                        })
                nxt = (data.get("_links", {}).get("next", {}) or {}).get("href")
                url = (base + nxt) if nxt else None
    except Exception as exc:
        logger.warning("openproject fetch_wiki_pages failed: %s", exc)
    return articles
