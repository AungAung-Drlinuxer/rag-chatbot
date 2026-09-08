from __future__ import annotations

from app.schemas import ArticleDraftRequest, ArticleRequest, ArticleSearchRequest

import json
import os
import re
import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.deps import get_current_user
from app.auth.rbac import require_role
from app.config import SETTINGS
from app.observability.audit import audit
from app.persistence.database import SessionLocal, engine

router = APIRouter()

@router.post("/api/articles/search")
def articles_search(req: ArticleSearchRequest, user: str = Depends(get_current_user)) -> dict:
    """Return KB articles for the user to select (design doc §7, Phase 1)."""
    from app.rag.retrieval import retrieve

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
    from app.orchestration.orchestrator import answer_chain

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
    from app.knowledge.ingest import ingest_article
    from app.integrations.confluence_write import create_kb_page

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


@router.get("/api/articles-domains")
def article_domains(user: str = Depends(get_current_user)) -> dict:
    """Domain browse cards for the Knowledge tab (merges classifier_domains with kb_meta counts, RBAC-filtered)."""
    from sqlalchemy import text as _text

    from app.auth.rbac import allowed_domains, get_role
    from app.persistence.database import SessionLocal
    from app.persistence.models import ClassifierDomain

    with SessionLocal() as s:
        # Load all active classifier domains metadata
        db_domains = s.query(ClassifierDomain).filter(ClassifierDomain.is_active == True).order_by(ClassifierDomain.id.asc()).all()
        meta_dict = {
            d.domain_key: {
                "display_name": d.display_name,
                "description": d.description,
                "icon": d.icon or "BookOpen",
                "color": d.color or "blue",
                "custom_icon": d.custom_icon,
            }
            for d in db_domains
        }

        # Page counts from kb_meta
        rows = s.execute(_text(
            "SELECT domain, count(*) AS pages, max(last_synced) AS last_synced "
            "FROM kb_meta GROUP BY domain ORDER BY pages DESC"
        )).mappings().all()

    counts = {
        (r["domain"] or "general"): {
            "pages": r["pages"],
            "last_synced": r["last_synced"].isoformat() if r["last_synced"] else None,
        }
        for r in rows
    }

    allowed = allowed_domains(get_role(user))
    all_keys = list(meta_dict.keys())
    for k in counts.keys():
        if k not in all_keys:
            all_keys.append(k)

    domains = []
    for k in all_keys:
        if allowed is not None and k not in allowed:
            continue
        c = counts.get(k, {"pages": 0, "last_synced": None})
        m = meta_dict.get(k, {})
        domains.append({
            "domain": k,
            "display_name": m.get("display_name") or k.capitalize(),
            "description": m.get("description") or f"Guides and resources for {k}.",
            "icon": m.get("icon") or "BookOpen",
            "color": m.get("color") or "blue",
            "custom_icon": m.get("custom_icon"),
            "pages": c["pages"],
            "last_synced": c["last_synced"],
        })

    return {"domains": domains}


@router.get("/api/articles-recent")
def articles_recent(limit: int = 8, user: str = Depends(get_current_user)) -> dict:
    """Recently updated KB pages (Knowledge tab section B)."""
    from sqlalchemy import text as _text

    from app.auth.rbac import allowed_domains, get_role
    from app.persistence.database import SessionLocal

    limit = max(1, min(limit, 25))
    with SessionLocal() as s:
        rows = s.execute(_text(
            "SELECT title, domain, source_url, updated_by, last_synced "
            "FROM kb_meta WHERE title IS NOT NULL "
            "ORDER BY last_synced DESC LIMIT :lim"
        ), {"lim": limit}).mappings().all()
    allowed = allowed_domains(get_role(user))
    articles = [
        {"title": r["title"], "domain": r["domain"] or "general", "source_url": r["source_url"],
         "updated_by": r["updated_by"], "last_synced": r["last_synced"].isoformat() if r["last_synced"] else None}
        for r in rows if allowed is None or (r["domain"] or "general") in allowed
    ]
    return {"articles": articles}


@router.get("/api/articles-list")
def articles_list(domain: str | None = None, q: str | None = None, limit: int = 50,
                  user: str = Depends(get_current_user)) -> dict:
    """Paged KB list for the Manage table (no vector calls; kb_meta only)."""
    from sqlalchemy import text as _text

    from app.auth.rbac import allowed_domains, get_role
    from app.persistence.database import SessionLocal

    limit = max(1, min(limit, 200))
    allowed = allowed_domains(get_role(user))
    if allowed is not None:
        if domain and domain not in allowed:
            return {"articles": [], "total": 0}
        domains = sorted(allowed)
    else:
        domains = None
    where = ["1=1"]
    params: dict = {"lim": limit}
    if domain:
        where.append("domain = :dom")
        params["dom"] = domain
    if q:
        where.append("(title ILIKE :q OR coalesce(body,'') ILIKE :q)")
        params["q"] = f"%{q}%"
    if domains is not None:
        where.append("coalesce(domain,'general') = ANY(:doms)")
        params["doms"] = domains
    sql = ("SELECT page_id, title, domain, source_url, updated_by, last_synced "
           f"FROM kb_meta WHERE {' AND '.join(where)} "
           "ORDER BY last_synced DESC NULLS LAST LIMIT :lim")
    with SessionLocal() as s:
        rows = s.execute(_text(sql), params).mappings().all()
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
    import json as _json

    from sqlalchemy import text as _text

    from app.persistence.database import SessionLocal
    from app.persistence.models import RuntimeKv

    with SessionLocal() as s:
        kv = s.get(RuntimeKv, "kb_last_sync")
        pages = s.execute(_text("SELECT count(*) FROM kb_meta")).scalar() or 0
    snap = _json.loads(kv.value) if kv and kv.value else None
    return {
        "pages": pages,
        "last_run": snap,
        "healthy": bool(snap),
        "beat_interval_minutes": 30,  # workers/celery_app.py beat schedule
    }


@router.delete("/api/articles/{page_id}")
def article_delete(page_id: str, user: str = Depends(get_current_user),
                   role: str = Depends(require_role("admin", "agent"))) -> dict:
    """Remove a KB article (vectors + sync meta)."""
    from app.persistence.database import SessionLocal
    from app.knowledge.ingest import _delete_vectors
    from app.persistence.models import KbMeta

    _delete_vectors(page_id)
    with SessionLocal() as s:
        meta = s.get(KbMeta, page_id)
        if meta:
            s.delete(meta)
            s.commit()
    try:
        from app.rag.bm25_index import BM25IndexManager
        BM25IndexManager.get_instance().invalidate()
    except Exception as exc:
        logging.getLogger("knowledge").debug("BM25 index invalidation ignored: %s", exc)
    return {"status": "deleted", "page_id": page_id}


# --------------------------------------------------------------------------
# Settings (Phase 10.1)
#   /api/settings            user prefs (GET/PUT)
#   /api/admin/settings      RAG-tuning overrides (admin only, GET/PUT/DELETE)
#   /api/integrations/status integration status grid (read-only; never secrets)
# --------------------------------------------------------------------------

