"""Hashnode integration — read published posts out of a Hashnode blog into the KB.

Config stored in `system_settings key='hashnode'` (JSON):
  { base_url, api_key, publication_host, domain, max_posts, include_drafts }

  base_url         — GraphQL endpoint. Default https://gql.hashnode.com
  api_key          — Personal Access Token (PAT) from
                     https://hashnode.com/settings/developer
  publication_host — the blog host, e.g. "blog.example.com". A full URL is accepted and
                     normalised (scheme and trailing slash are stripped), because pasting
                     the address bar is the obvious thing to do and `publication(host:)`
                     only accepts a bare host.
  domain           — KB domain tag; empty → auto-classified from title/body
  max_posts        — safety ceiling on posts fetched per sync (default 200)
  include_drafts   — "true" to also pull drafts (needs the PAT to own the publication)

FOUR HASHNODE-SPECIFIC TRAPS this module handles explicitly:

1. THE ENDPOINT IS POST-ONLY, AND THE OLD ONE IS DEAD. All queries go to
   https://gql.hashnode.com as a POST with a JSON body. The legacy
   https://api.hashnode.com was shut down and answers 502 — a client still pointed at it
   looks like an outage rather than a stale URL, which is why the default here is the new
   host and `base_url` is overridable only deliberately.

2. HTTP 200 DOES NOT MEAN SUCCESS. GraphQL reports application errors inside a 200
   response as an `errors` array, often with no `data` at all. Checking only the status
   code would silently index zero posts and report a clean sync, so `_gql()` inspects
   `errors` and returns None.

3. READS ARE NOW PAID (2026-05-13). Hashnode retired free GraphQL access: every query
   requires a Pro plan on the publication. A non-Pro publication is refused with an
   authorization error, so `test_connection()` says so in those words instead of leaving
   the operator to guess.

4. A NULL BODY IS NOT AN ARTICLE. `content.markdown` can be absent. A post whose body
   comes out blank is NOT indexed — a blank article in the knowledge base is worse than a
   missing one, because it can be retrieved and cited as if it were an answer.

Reads only: this module never issues a mutation.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import text

from app.persistence.database import SessionLocal

logger = logging.getLogger("integrations.hashnode")

_INTEGRATION_KEY = "hashnode"
_DEFAULT_BASE = "https://gql.hashnode.com"
_PAGE_SIZE = 20            # posts per GraphQL page
_MAX_PAGES = 50            # hard stop, independent of max_posts

# One query per page returns the full body of every post on that page, so a sync costs
# ceil(posts / 20) requests rather than one per post. `id` is requested on every node
# because Hashnode's edge cache returns stale data without it.
_POSTS_QUERY = """
query Posts($host: String!, $first: Int!, $after: String) {
  publication(host: $host) {
    id
    title
    posts(first: $first, after: $after) {
      edges {
        node {
          id
          title
          slug
          url
          brief
          publishedAt
          content { markdown }
        }
      }
      pageInfo { endCursor hasNextPage }
    }
  }
}
"""

_DRAFTS_QUERY = """
query Drafts($host: String!, $first: Int!, $after: String) {
  publication(host: $host) {
    id
    title
    drafts(first: $first, after: $after) {
      edges {
        node {
          id
          title
          slug
          content { markdown }
        }
      }
      pageInfo { endCursor hasNextPage }
    }
  }
}
"""


def get_hashnode_cfg() -> dict:
    """Read Hashnode config from system_settings (JSON string or dict)."""
    try:
        with SessionLocal() as s:
            row = s.execute(
                text("SELECT value FROM system_settings WHERE key = :k"),
                {"k": _INTEGRATION_KEY},
            ).first()
    except Exception as exc:
        logger.warning("hashnode cfg read failed: %s", exc)
        return {}
    val = row[0] if row else {}
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except (TypeError, ValueError):
            return {}
    return val or {}


def _base(cfg: dict) -> str:
    return (cfg.get("base_url") or _DEFAULT_BASE).strip().rstrip("/") or _DEFAULT_BASE


def _host(cfg: dict) -> str:
    """`publication(host:)` wants a bare host — accept a pasted URL and normalise it."""
    raw = (cfg.get("publication_host") or "").strip()
    for prefix in ("https://", "http://"):
        if raw.lower().startswith(prefix):
            raw = raw[len(prefix):]
    return raw.rstrip("/").split("/")[0].strip()


def _headers(cfg: dict) -> dict:
    return {
        "Authorization": f"Bearer {(cfg.get('api_key') or '').strip()}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _gql(client, cfg: dict, query: str, variables: dict) -> dict | None:
    """POST one GraphQL query. Returns `data` or None.

    A GraphQL error arrives inside an HTTP 200, so the status code alone is not enough —
    trap 2 in the module docstring. The error text is logged because it is the only place
    the Pro-plan refusal (trap 3) shows up.
    """
    try:
        r = client.post(
            _base(cfg),
            headers=_headers(cfg),
            json={"query": query, "variables": variables},
        )
    except Exception as exc:
        logger.warning("hashnode POST failed: %s", exc)
        return None
    if r.status_code != 200:
        logger.warning("hashnode POST -> HTTP %s: %s", r.status_code, r.text[:200])
        return None
    try:
        payload = r.json()
    except ValueError:
        logger.warning("hashnode POST returned non-JSON")
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("errors"):
        logger.warning("hashnode GraphQL errors: %s", str(payload["errors"])[:300])
        return None
    data = payload.get("data")
    return data if isinstance(data, dict) else None


def _edges(connection) -> list[dict]:
    """Pull nodes out of a Relay connection, tolerating a null/malformed wrapper."""
    if not isinstance(connection, dict):
        return []
    edges = connection.get("edges")
    if not isinstance(edges, list):
        return []
    out: list[dict] = []
    for e in edges:
        node = (e or {}).get("node")
        if isinstance(node, dict):
            out.append(node)
    return out


def _page_info(connection) -> tuple[bool, str | None]:
    info = (connection or {}).get("pageInfo") if isinstance(connection, dict) else None
    if not isinstance(info, dict):
        return False, None
    cursor = info.get("endCursor")
    return bool(info.get("hasNextPage")), (str(cursor) if cursor else None)


def _body_of(node: dict) -> str:
    """Markdown body of a post, or '' when the API has none."""
    content = node.get("content")
    if isinstance(content, dict):
        md = content.get("markdown")
        if isinstance(md, str) and md.strip():
            return md.strip()
    return ""


def _title_of(node: dict) -> str:
    t = node.get("title")
    if isinstance(t, str) and t.strip():
        return t.strip()
    slug = node.get("slug")
    return str(slug).strip() if slug else "Untitled"


def test_connection() -> dict:
    """Connectivity test used by /settings/integrations/hashnode/test.

    Separates the outcomes an operator can act on:
      no PAT / no host → nothing to try
      401/403          → the PAT is wrong, revoked, or the publication is not on Pro
                         (Hashnode retired free GraphQL reads on 2026-05-13)
      GraphQL errors   → the query was refused; the message is the whole story
      200 + publication → ok, and the post count is returned as evidence
    """
    import httpx

    cfg = get_hashnode_cfg()
    key = (cfg.get("api_key") or "").strip()
    host = _host(cfg)
    if not key:
        return {"ok": False, "message": "api_key (Personal Access Token) not set — create one "
                                        "at hashnode.com/settings/developer, paste it and Save first"}
    if not host:
        return {"ok": False, "message": "publication_host not set — enter the blog host, "
                                        "e.g. blog.example.com"}

    base = _base(cfg)
    try:
        with httpx.Client(timeout=20) as client:
            r = client.post(
                base,
                headers=_headers(cfg),
                json={
                    "query": "query Probe($host: String!) { publication(host: $host) "
                             "{ id title posts(first: 1) { totalDocuments } } }",
                    "variables": {"host": host},
                },
            )
    except Exception as exc:
        return {"ok": False, "message": f"cannot reach {base}: {type(exc).__name__}: {exc}"}

    if r.status_code in (401, 403):
        return {"ok": False, "message": f"rejected (HTTP {r.status_code}). Either the PAT is wrong, "
                                        f"or this publication is not on a Pro plan — Hashnode "
                                        f"requires Pro for all GraphQL reads since 2026-05-13."}
    if r.status_code != 200:
        hint = ("A 502 almost always means base_url still points at the legacy "
                "api.hashnode.com, which is shut down — use https://gql.hashnode.com. "
                if r.status_code == 502 else "")
        return {"ok": False, "message": f"HTTP {r.status_code} from {base}. {hint}{r.text[:160]}"}

    try:
        payload = r.json()
    except ValueError:
        return {"ok": False, "message": f"{base} returned non-JSON — is base_url correct?"}

    if payload.get("errors"):
        return {"ok": False, "message": f"GraphQL refused the query: {str(payload['errors'])[:300]}"}

    pub = ((payload.get("data") or {}).get("publication"))
    if not isinstance(pub, dict):
        return {"ok": False, "message": f"no publication at host '{host}' — check the host "
                                        f"(it must be the blog's own domain, not the Hashnode "
                                        f"profile URL)"}

    total = ((pub.get("posts") or {}).get("totalDocuments"))
    name = pub.get("title") or host
    return {
        "ok": True,
        "message": f"connected to '{name}' ({host})"
                   + (f" — {total} published post(s)" if isinstance(total, int) else ""),
        "publication": name,
        "posts": total if isinstance(total, int) else None,
    }


def fetch_pages() -> list[dict]:
    """Pull Hashnode posts as KB article dicts.

    Returns [{page_id, title, domain?, source_url, body, meta?}] — the shared loader
    contract consumed by `app/knowledge/loaders.load_all()`.
    """
    import httpx

    cfg = get_hashnode_cfg()
    if not (cfg.get("api_key") or "").strip():
        return []
    host = _host(cfg)
    if not host:
        logger.warning("hashnode: publication_host not set — nothing to fetch")
        return []

    domain = (cfg.get("domain") or "").strip().lower()
    try:
        max_posts = int(str(cfg.get("max_posts") or "200").strip() or 200)
    except ValueError:
        max_posts = 200
    include_drafts = str(cfg.get("include_drafts") or "").strip().lower() in {"1", "true", "yes", "on"}

    articles: list[dict] = []

    def _collect(client, query: str, kind: str) -> None:
        """Walk one Relay connection to exhaustion, respecting max_posts."""
        cursor: str | None = None
        for _ in range(_MAX_PAGES):
            if len(articles) >= max_posts:
                return
            data = _gql(client, cfg, query, {"host": host, "first": _PAGE_SIZE, "after": cursor})
            pub = (data or {}).get("publication") if data else None
            if not isinstance(pub, dict):
                return
            conn = pub.get(kind)
            batch = _edges(conn)
            if not batch:
                return

            for node in batch:
                if len(articles) >= max_posts:
                    return
                body = _body_of(node)
                if not body:
                    # Trap 4 — a blank article is worse than a missing one.
                    logger.debug("hashnode %s %s produced no body — skipped", kind, node.get("id"))
                    continue
                nid = str(node.get("id") or node.get("slug") or "").strip()
                if not nid:
                    continue
                title = _title_of(node)
                art: dict = {
                    "page_id": f"hashnode-{nid}",
                    "title": title,
                    "source_url": str(node.get("url") or f"https://{host}/{node.get('slug') or ''}"),
                    "body": body,
                }
                if domain:
                    art["domain"] = domain
                art["meta"] = {
                    "source": "hashnode",
                    "publication": host,
                    "kind": kind[:-1] if kind.endswith("s") else kind,
                    "slug": node.get("slug"),
                    "published_at": node.get("publishedAt"),
                    "brief": node.get("brief"),
                }
                articles.append(art)

            more, cursor = _page_info(conn)
            if not more or not cursor:
                return

    try:
        with httpx.Client(timeout=60) as client:
            _collect(client, _POSTS_QUERY, "posts")
            if include_drafts and len(articles) < max_posts:
                _collect(client, _DRAFTS_QUERY, "drafts")
    except Exception as exc:
        logger.warning("hashnode fetch_pages failed: %s", exc)

    logger.info("hashnode: %d post(s) fetched from %s", len(articles), host)
    return articles
