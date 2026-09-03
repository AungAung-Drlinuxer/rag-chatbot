"""Ingest (Phase 7) — chunk → embed → upsert into pgvector, idempotent + change-detection.

Change-detection: an md5(title+body) is stored in `kb_meta`; a repeat sync with the same
hash SKIPS the page. A changed page is re-chunked/re-embedded (old vectors pruned first).

Metadata rules live in `app.knowledge.metadata`; the kb_meta/vector writes are
delegated to `app.persistence` (GOVERNANCE Rule 3).
"""
from __future__ import annotations

import logging

from app.core.config import SETTINGS
from app.knowledge import metadata
from app.knowledge.chunker import chunk_text
from app.knowledge.loaders import load_all
from app.persistence.repositories import documents
from app.persistence.search import delete_page_vectors
from app.rag import add_texts

logger = logging.getLogger("ingest")


def ingest_article(art: dict) -> str:
    """Ingest one article → 'inserted' | 'updated' | 'skipped'."""
    art = {**art, "domain": metadata.effective_domain(art)}
    chash = metadata.content_hash(art["title"], art["body"])
    existing = documents.get_meta(art["page_id"])

    if existing and existing.content_hash == chash:
        return "skipped"

    chunks = chunk_text(
        art["body"],
        chunk_tokens=SETTINGS.chunk_tokens,
        overlap=SETTINGS.chunk_overlap,
        context_prefix=art["title"],  # v0.10.0: every chunk carries title+header context
    )
    metadatas = [{
        "page_id": art["page_id"],
        "page_title": art["title"],
        "domain": art["domain"],
        "source_url": art["source_url"],
        "content_hash": chash,
        "chunk_index": str(i),
    } for i in range(len(chunks))]

    if existing:
        delete_page_vectors(art["page_id"])

    if chunks:
        add_texts(chunks, metadatas=metadatas)
    documents.upsert_meta(art["page_id"], chash, art["domain"], art["title"],
                          art.get("source_url") or "", body=art.get("body"),
                          updated_by=art.get("updated_by"))

    return "updated" if existing else "inserted"


def sync_all(updated_by: str | None = None) -> dict:
    """Sync every configured KB source. Returns counts (+ persists a health snapshot)."""
    articles = load_all()
    stats = {"pages": len(articles), "inserted": 0, "updated": 0, "skipped": 0}
    try:
        from app.persistence.database import init_db
        init_db()  # ensure kb_meta table exists
    except Exception as exc:
        logger.warning(f"init_db during sync skipped ({type(exc).__name__}): {exc}")
    for art in articles:
        status = ingest_article({**art, "updated_by": updated_by or art.get("updated_by")})
        stats[status] += 1
    logger.info("sync done %s", stats)

    # Sync-health snapshot for the Knowledge tab strip (best-effort).
    try:
        import json
        from datetime import UTC
        from datetime import datetime as _dt

        from app.persistence.database import SessionLocal
        from app.persistence.models import RuntimeKv
        with SessionLocal() as s:
            kv = s.get(RuntimeKv, "kb_last_sync") or RuntimeKv(key="kb_last_sync")
            kv.value = json.dumps({"at": _dt.now(UTC).isoformat(), **stats})
            s.add(kv)
            s.commit()
    except Exception as exc:
        logger.warning(f"sync-health snapshot skipped ({type(exc).__name__}): {exc}")

    return stats
