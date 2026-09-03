"""KB document sync-meta (`kb_meta`) queries (owned by persistence/)."""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import text

from app.persistence.database import SessionLocal
from app.persistence.models import KbMeta


def get_meta(page_id: str) -> KbMeta | None:
    with SessionLocal() as s:
        return s.get(KbMeta, page_id)


def upsert_meta(page_id: str, chash: str, domain: str, title: str, source_url: str,
                body: str | None = None, updated_by: str | None = None) -> None:
    with SessionLocal() as s:
        meta = s.get(KbMeta, page_id) or KbMeta(page_id=page_id)
        meta.content_hash = chash
        meta.domain = domain
        meta.title = title
        meta.source_url = source_url
        if body is not None:
            meta.body = body
        if updated_by:
            meta.updated_by = updated_by
        meta.last_synced = datetime.now(UTC)
        s.add(meta)
        s.commit()


def domain_counts() -> list[dict]:
    """Per-domain page counts + last sync, ordered by size."""
    with SessionLocal() as s:
        rows = s.execute(text(
            "SELECT domain, count(*) AS pages, max(last_synced) AS last_synced "
            "FROM kb_meta GROUP BY domain ORDER BY pages DESC"
        )).mappings().all()
    return [dict(r) for r in rows]


def recent(limit: int) -> list[dict]:
    """Recently updated KB pages (titles + sync metadata)."""
    with SessionLocal() as s:
        rows = s.execute(text(
            "SELECT title, domain, source_url, updated_by, last_synced "
            "FROM kb_meta WHERE title IS NOT NULL "
            "ORDER BY last_synced DESC LIMIT :lim"
        ), {"lim": limit}).mappings().all()
    return [dict(r) for r in rows]


def search_list(*, domain: str | None, q: str | None, domains: list[str] | None,
                limit: int) -> list[dict]:
    """Paged KB list over kb_meta only (no vector calls)."""
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
        rows = s.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def delete_meta(page_id: str) -> bool:
    """Remove the kb_meta row (vector pruning lives in persistence.search)."""
    with SessionLocal() as s:
        meta = s.get(KbMeta, page_id)
        if meta:
            s.delete(meta)
            s.commit()
            return True
        return False


def page_count() -> int:
    with SessionLocal() as s:
        return s.execute(text("SELECT count(*) FROM kb_meta")).scalar() or 0
