"""Knowledge HTTP routes — KB article CRUD, sync, search, drafts (API surface)."""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException

from app.core.dependencies import allowed_domains, get_current_user, get_role, require_role
from app.observability.audit import audit
from app.persistence.database import SessionLocal
from app.persistence.repositories import documents
from app.schemas import ArticleDraftRequest, ArticleRequest, ArticleSearchRequest

logger = logging.getLogger("it-help-chatbot")

router = APIRouter(tags=["knowledge"])


@router.post("/api/articles/search")
def articles_search(req: ArticleSearchRequest, user: str = Depends(get_current_user)) -> dict:
    """Return KB articles for the user to select (design doc §7, Phase 1)."""
    from app.rag import retrieve

    try:
        docs = retrieve(req.query, domain=req.domain, k=req.top_k)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"retrieval unavailable: {type(exc).__name__}")
    return {
        "query": req.query,
        "domain": req.domain,
        "articles": [{"title": d["title"], "confidence": d["confidence"],
                      "source_url": d["source_url"], "domain": d["domain"]} for d in docs],
    }


@router.post("/api/articles/sync")
def articles_sync(user: str = Depends(get_current_user),
                  role: str = Depends(require_role("admin", "agent"))) -> dict:
    """Trigger a KB sync (Phase 7 — from all configured sources)."""
    from app.knowledge.ingest import sync_all

    audit("sync", user, detail="kb_sync")
    return sync_all(updated_by=user)


@router.post("/api/articles/draft")
def article_draft(req: ArticleDraftRequest, user: str = Depends(get_current_user),
                  role: str = Depends(require_role("admin", "agent"))) -> dict:
    """AI writing assist — generate a KB article draft for the given topic/domain."""
    from app.orchestration import answer_chain

    prompt = (
        "You are an internal IT knowledge-base author. Write a concise, practical "
        f"KB article in Confluence style about: {req.topic} (domain: {req.domain}).\n"
        "Structure it with: Overview, Steps (numbered), Verification, and Troubleshooting. "
        "Keep it factual and generic to the domain. Max ~300 words."
    )
    try:
        text = answer_chain().invoke(
            {"context": "(no retrieved documents — draft from domain knowledge)",
             "question": prompt}
        )
        return {"draft": text}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"draft generation failed: {type(exc).__name__}")


@router.post("/api/articles")
def article_create(req: ArticleRequest, user: str = Depends(get_current_user),
                   role: str = Depends(require_role("admin", "agent"))) -> dict:
    """Add a KB article — v0.19.0: writes to Confluence (domain section) when
    the space is configured, then ingests locally. Falls back to local-only
    (page_id kept) if the Confluence write fails."""
    from app.integrations.confluence_write import create_kb_page
    from app.knowledge.ingest import ingest_article

    confluence = create_kb_page(req.title, req.body, req.domain)

    page_id = req.page_id
    source_url = req.source_url
    if confluence.get("ok"):
        page_id = confluence["page_id"]
        source_url = confluence.get("url") or source_url

    payload = req.model_dump()
    payload["page_id"] = page_id
    payload["source_url"] = source_url
    status = ingest_article(payload)
    return {
        "status": status,
        "page_id": page_id,
        "confluence": confluence,
    }


@router.put("/api/articles/{page_id}")
def article_update(page_id: str, req: ArticleRequest, user: str = Depends(get_current_user),
                   role: str = Depends(require_role("admin", "agent"))) -> dict:
    """Update a KB article (change-detected → re-embed)."""
    from app.knowledge.ingest import ingest_article

    return {"status": ingest_article({**req.model_dump(), "page_id": page_id, "updated_by": user}), "page_id": page_id}


@router.delete("/api/articles/{page_id}")
def article_delete(page_id: str, user: str = Depends(get_current_user),
                   role: str = Depends(require_role("admin", "agent"))) -> dict:
    """Remove a KB article (vectors + sync meta)."""
    from app.persistence.search import delete_page_vectors

    delete_page_vectors(page_id)
    documents.delete_meta(page_id)
    return {"status": "deleted", "page_id": page_id}


@router.get("/api/articles-domains")
def article_domains(user: str = Depends(get_current_user)) -> dict:
    """Domain browse cards for the Knowledge tab (counts from kb_meta, RBAC-filtered)."""
    allowed = allowed_domains(get_role(user))
    domains = [
        {"domain": r["domain"] or "general", "pages": r["pages"],
         "last_synced": r["last_synced"].isoformat() if r["last_synced"] else None}
        for r in documents.domain_counts()
        if allowed is None or (r["domain"] or "general") in allowed
    ]
    return {"domains": domains}


@router.get("/api/articles-recent")
def articles_recent(limit: int = 8, user: str = Depends(get_current_user)) -> dict:
    """Recently updated KB pages (Knowledge tab section B)."""
    allowed = allowed_domains(get_role(user))
    limit = max(1, min(limit, 25))
    articles = [
        {"title": r["title"], "domain": r["domain"] or "general", "source_url": r["source_url"],
         "updated_by": r["updated_by"], "last_synced": r["last_synced"].isoformat() if r["last_synced"] else None}
        for r in documents.recent(limit)
        if allowed is None or (r["domain"] or "general") in allowed
    ]
    return {"articles": articles}


@router.get("/api/articles-list")
def articles_list(domain: str | None = None, q: str | None = None, limit: int = 50,
                  user: str = Depends(get_current_user)) -> dict:
    """Paged KB list for the Manage table (no vector calls; kb_meta only)."""
    limit = max(1, min(limit, 200))
    allowed = allowed_domains(get_role(user))
    if allowed is not None:
        if domain and domain not in allowed:
            return {"articles": [], "total": 0}
        domains = sorted(allowed)
    else:
        domains = None
    rows = documents.search_list(domain=domain, q=q, domains=domains, limit=limit)
    articles = [
        {"page_id": r["page_id"], "title": r["title"], "domain": r["domain"] or "general",
         "source_url": r["source_url"], "updated_by": r["updated_by"],
         "last_synced": r["last_synced"].isoformat() if r["last_synced"] else None}
        for r in rows
    ]
    return {"articles": articles, "total": len(articles)}


@router.get("/api/sync-status")
def sync_status(user: str = Depends(get_current_user)) -> dict:
    """Last sync snapshot + next beat ETA (Knowledge tab header/health strip)."""
    from app.persistence.models import RuntimeKv

    with SessionLocal() as s:
        kv = s.get(RuntimeKv, "kb_last_sync")
    pages = documents.page_count()
    snap = json.loads(kv.value) if kv and kv.value else None
    return {
        "pages": pages,
        "last_run": snap,
        "healthy": bool(snap),
        "beat_interval_minutes": 30,  # workers/celery_app.py beat schedule
    }


@router.get("/api/contacts/{domain}")
def contacts(domain: str, user: str = Depends(get_current_user)) -> dict:
    from app.integrations.contacts import get_contact

    return get_contact(domain)
