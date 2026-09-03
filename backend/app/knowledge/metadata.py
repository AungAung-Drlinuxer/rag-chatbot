"""KB article metadata — change-detection hashes + domain resolution.

Kept pure (no DB): ingest.py owns persistence; this module owns the metadata
derivation rules (what counts as "changed", which pipeline domain an article
belongs to).
"""
from __future__ import annotations

import hashlib

# Bump when chunking/embedding format changes so all pages re-ingest once.
CHUNK_FORMAT_VERSION = "v4-domain-classified-v2"  # v0.10.0: title+header prefixed chunks

# Pipeline domains a source article may land in (anything else is placeholder).
KNOWN_DOMAINS = {"database", "network", "security", "server", "kubernetes",
                 "storage", "general"}


def content_hash(title: str, body: str) -> str:
    """md5(format+title+body) — the change-detection key stored in kb_meta."""
    return hashlib.md5(
        f"{CHUNK_FORMAT_VERSION}\x00{title}\x00{body}".encode()
    ).hexdigest()


def effective_domain(art: dict) -> str:
    """Resolve a real pipeline domain for the article.

    Sources that set a meaningful domain keep it; space-key placeholders
    (e.g. Confluence 'ihkb') are re-classified from title+body keywords so the
    retriever's domain filter can actually match (v0.10.1).
    """
    domain = (art.get("domain") or "").strip().lower()
    if domain in KNOWN_DOMAINS:
        return domain
    from app.classifier import classify_domain

    # Title signal first (more reliable than body keywords) — v0.10.8.
    title = art.get("title", "") or ""
    d, conf = classify_domain(title)
    if conf >= 0.75:
        return d
    text = f"{title} {(art.get('body') or '')[:1500]}".lower()
    d, conf = classify_domain(text)
    if conf >= 0.7:
        return d
    return "general"
