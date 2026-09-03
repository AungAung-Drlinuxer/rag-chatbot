"""Confluence article puller — langchain-community ConfluenceLoader (Phase 1 MVP).

If Confluence creds are configured, pulls real articles; otherwise returns a dev
sample set so the ingest pipeline can be verified end-to-end without network/creds.
"""
from __future__ import annotations

from app.config import SETTINGS


def _fetch_confluence_rest(space_key: str) -> list[dict]:
    """CQL-filtered Confluence REST fetcher using email + API-token Basic auth.

    Safety: only pulls pages tagged 'approved' + 'chatbot-safe' (excludes restricted/internal-only/on-call).
    Service-account permissions still enforce the real access boundary; CQL is an extra layer.
    """
    import base64

    import httpx

    # Two paths supported:
    # A) Atlassian Cloud unified API gateway (preferred for OAuth/Bearer tokens):
    #    GET https://api.atlassian.com/ex/confluence/{cloudId}/wiki/rest/api/content/search
    # B) Direct tenant URL with Basic auth (legacy / non-Cloud):
    #    GET https://{tenant}/wiki/rest/api/content/search
    cloud_id = SETTINGS.confluence_cloud_id
    token = SETTINGS.confluence_token
    if not token:
        return []
    if cloud_id:
        # Bearer token + unified gateway (works for both OAuth and PAT in modern Atlassian Cloud)
        api_root = f"https://api.atlassian.com/ex/confluence/{cloud_id}/wiki"
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    else:
        base_url = SETTINGS.confluence_base_url.rstrip("/")
        email = SETTINGS.confluence_email
        if not base_url or not email:
            return []
        auth = base64.b64encode(f"{email}:{token}".encode()).decode()
        api_root = base_url
        headers = {"Authorization": f"Basic {auth}", "Accept": "application/json"}

    # CQL filter per design guide. By default require chatbot-safe label.
    # Set CONFLUENCE_SKIP_LABEL_FILTER=1 to ingest all pages (debug / first-run).
    import os
    if os.environ.get("CONFLUENCE_SKIP_LABEL_FILTER") == "1":
        cql = f'space = "{space_key}" AND type = page'
    else:
        cql = (
            f'space = "{space_key}" '
            'AND type = page '
            'AND label = "approved" '
            'AND label = "chatbot-safe" '
            'AND label != "restricted" '
            'AND label != "internal-only" '
            'AND label != "on-call"'
        )
        docs: list[dict] = []
    with httpx.Client(timeout=30, headers=headers) as client:
        # Paginate via _links.next (v0.16.0) — default limit 100 misses larger spaces.
        api_path = "/rest/api/content/search"
        params: dict = {"cql": cql, "limit": 100, "expand": "body.storage,version,metadata.labels"}
        while True:
            resp = client.get(api_root + api_path, params=params)
            resp.raise_for_status()
            payload = resp.json()
            for page in payload.get("results", []):
                body_html = page.get("body", {}).get("storage", {}).get("value", "")
                body_text = _html_to_text(body_html)
                page_id = page.get("id", "")
                webui = page.get("_links", {}).get("webui", "")
                docs.append({
                    "page_id": page_id,
                    "title": page.get("title", "Untitled"),
                    "domain": space_key.lower(),
                    "source_url": (
                        SETTINGS.confluence_base_url.rstrip("/") + "/" + webui.lstrip("/")
                        if webui else f"{api_root}/spaces/{space_key}/pages/{page_id}"
                    ),
                    "body": body_text,
                })
            next_link = payload.get("_links", {}).get("next")
            if not next_link:
                break
            # _links.next is a relative path — keep calling the same API root
            api_path = next_link if next_link.startswith("/") else "/" + next_link
    return docs


def _html_to_text(html: str) -> str:
    """Strip HTML to plain text for embedding. Cheap & dependency-free."""
    import re
    # remove tags
    text = re.sub(r"<[^>]+>", " ", html)
    # decode entities
    import html as htmlmod
    text = htmlmod.unescape(text)
    # collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def fetch_space(space_key: str) -> list[dict]:
    """Return Confluence articles for a space. No mock fallback — Confluence is the only KB source (v0.16.0)."""
    if SETTINGS.confluence_base_url and SETTINGS.confluence_token:
        return _fetch_confluence_rest(space_key)
    return []
