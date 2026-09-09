"""Multi-source KB loaders (Phase 7) — Confluence + file shares / runbooks (txt/md/pdf/docx).

Returns article dicts: {page_id, title, domain, source_url, body}.
"""
from __future__ import annotations

import logging
import os

from app.config import SETTINGS
from app.integrations.confluence import fetch_space as _fetch_confluence

logger = logging.getLogger("knowledge.loaders")

_TEXTLIKE = (".md", ".txt", ".pdf", ".docx")


def load_confluence() -> list[dict]:
    articles: list[dict] = []
    for space in [s.strip() for s in SETTINGS.confluence_space_keys.split(",") if s.strip()]:
        for a in _fetch_confluence(space):
            a["domain"] = a.get("domain") or space.lower()
            articles.append(a)
    return articles


def _read_text(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext in (".md", ".txt"):
        with open(path, encoding="utf-8", errors="ignore") as f:
            return f.read()
    if ext == ".pdf":
        try:
            import pymupdf  # optional — install `pymupdf` for PDFs
            return "\n".join(p.get_text() for p in pymupdf.open(path))
        except Exception:
            return ""
    if ext == ".docx":
        try:
            import docx  # optional — install `python-docx`
            return "\n".join(p.text for p in docx.Document(path).paragraphs)
        except Exception:
            return ""
    return ""


def load_fileshare(base_dir: str | None = None) -> list[dict]:
    base = base_dir or SETTINGS.fileshare_dir
    if not os.path.isdir(base):
        return []
    articles: list[dict] = []
    for root, _, files in os.walk(base):
        for fname in sorted(files):
            if not fname.lower().endswith(_TEXTLIKE):
                continue
            full = os.path.join(root, fname)
            body = _read_text(full)
            if not body:
                continue
            stem = os.path.splitext(fname)[0]
            articles.append({
                "page_id": f"fs-{stem}",
                "title": fname,
                "domain": SETTINGS.fileshare_domain,
                "source_url": f"{SETTINGS.fileshare_domain}://{full.replace(os.sep, '/')}",
                "body": body,
            })
    return articles


def load_all() -> list[dict]:
    """Aggregate KB sources (v1.1.0): Confluence + OpenProject wiki + XWiki.

    Each loader returns article dicts with the standard shape; missing/empty
    integrations simply contribute nothing (safe no-op)."""
    articles: list[dict] = []
    articles.extend(load_confluence())

    try:
        from app.integrations.openproject import fetch_wiki_pages as _fetch_op_wiki
        articles.extend(_fetch_op_wiki())
    except Exception as exc:  # pragma: no cover — never break the whole ingest
        logger.warning("openproject wiki load skipped: %s", exc)

    try:
        from app.integrations.xwiki import fetch_pages as _fetch_xwiki
        articles.extend(_fetch_xwiki())
    except Exception as exc:  # pragma: no cover
        logger.warning("xwiki load skipped: %s", exc)

    return articles
