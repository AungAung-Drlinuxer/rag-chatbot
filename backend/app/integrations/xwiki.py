"""XWiki integration — REST API client for KB page ingestion (external server).

XWiki runs on an external server (NOT in the cluster). Config stored in
`system_settings key='xwiki'` (JSON):
  { base_url, username, api_token, wiki, spaces (comma list) }

Auth: Basic auth with username + api_token (XWiki standard).
Endpoints: /rest/wikis/{wiki}/spaces/{space}/pages
"""
from __future__ import annotations

import base64
import logging

from app.persistence.database import SessionLocal
from sqlalchemy import text

logger = logging.getLogger("integrations.xwiki")

_INTEGRATION_KEY = "xwiki"


def get_xwiki_cfg() -> dict:
    """Read XWiki config from system_settings (JSON string or dict)."""
    import json as _json

    try:
        with SessionLocal() as s:
            row = s.execute(
                text("SELECT value FROM system_settings WHERE key = :k"),
                {"k": _INTEGRATION_KEY},
            ).first()
    except Exception as exc:
        logger.warning("xwiki cfg read failed: %s", exc)
        return {}
    val = row[0] if row else {}
    if isinstance(val, str):
        try:
            val = _json.loads(val)
        except (TypeError, ValueError):
            return {}
    return val or {}


def test_connection() -> dict:
    """Connectivity test used by /settings/integrations/xwiki/test."""
    import httpx

    cfg = get_xwiki_cfg()
    base = (cfg.get("base_url") or "").rstrip("/")
    user = cfg.get("username") or ""
    token = cfg.get("api_token") or ""
    if not base or not user or not token:
        return {"ok": False, "message": "base_url, username and api_token are required"}
    try:
        r = httpx.get(
            f"{base}/rest/wikis/{cfg.get('wiki') or 'xwiki'}",
            auth=(user, token),
            headers={"Accept": "application/xml"},
            timeout=15,
        )
        if r.status_code == 200:
            return {"ok": True, "message": "Connected to XWiki instance"}
        return {"ok": False, "message": f"HTTP {r.status_code}"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


def fetch_pages() -> list[dict]:
    """Pull pages from the configured XWiki spaces as KB article dicts.

    Returns: [{page_id ('xwiki-<space>-<page>'), title, body, source_url}]
    """
    import httpx

    cfg = get_xwiki_cfg()
    base = (cfg.get("base_url") or "").rstrip("/")
    user = cfg.get("username") or ""
    token = cfg.get("api_token") or ""
    wiki = cfg.get("wiki") or "xwiki"
    spaces = [s.strip() for s in (cfg.get("spaces") or "").split(",") if s.strip()]
    if not base or not user or not token or not spaces:
        return []

    auth = base64.b64encode(f"{user}:{token}".encode()).decode()
    headers = {"Authorization": f"Basic {auth}", "Accept": "application/json"}
    articles: list[dict] = []

    try:
        with httpx.Client(timeout=30, headers=headers) as client:
            for space in spaces:
                url = f"{base}/rest/wikis/{wiki}/spaces/{space}/pages?limit=100"
                while url:
                    r = client.get(url)
                    if r.status_code != 200:
                        logger.warning("xwiki pages HTTP %s for space %s", r.status_code, space)
                        break
                    entries = r.json()
                    # XWiki returns a list or a page-wrapped dict depending on config
                    if isinstance(entries, dict):
                        entries = entries.get("page_summaries", entries.get("pages", []))
                    for entry in entries:
                        page_ref = entry.get("id") or f"{space}.{entry.get('name', '')}"
                        title = entry.get("title") or entry.get("name", "")
                        # fetch full page (xhtml body)
                        rf = client.get(f"{base}/rest/wikis/{wiki}/spaces/{space}/pages/{entry.get('name', '')}")
                        body = ""
                        if rf.status_code == 200:
                            content = rf.json().get("content", "") if isinstance(rf.json(), dict) else rf.text
                            body = _strip_xml(content)
                        if body:
                            safe_ref = page_ref.replace("/", "-").replace(".", "-")
                            articles.append({
                                "page_id": f"xwiki-{safe_ref}",
                                "title": title,
                                "source_url": f"{base}/bin/view/{space}/{entry.get('name', '')}",
                                "body": body,
                            })
                    nxt = None
                    links = entries.get("links", []) if isinstance(entries, dict) else []
                    for lnk in links:
                        if lnk.get("rel") == "next":
                            nxt = lnk.get("href")
                    url = nxt
    except Exception as exc:
        logger.warning("xwiki fetch_pages failed: %s", exc)
    return articles


def _strip_xml(raw: str) -> str:
    import re

    text = re.sub(r"<[^>]+>", " ", raw or "")
    return re.sub(r"\s+", " ", text).strip()
