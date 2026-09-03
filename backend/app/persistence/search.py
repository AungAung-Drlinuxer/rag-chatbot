"""Raw-SQL access to the LangChain pgvector chunk tables.

Rule 3 (GOVERNANCE): all direct SQL lives in persistence/. The RAG package
formats results; this module only executes queries against the
`langchain_pg_embedding` store managed by LangChain PGVector.
"""
from __future__ import annotations

from sqlalchemy import text as sqltext

from app.persistence.database import engine


def fts_chunk_rows(terms: list[str], limit: int) -> list[tuple]:
    """Full-text (websearch_to_tsquery) search over chunk document + metadata."""
    with engine.begin() as conn:
        return conn.execute(
            sqltext(
                "SELECT document, cmetadata "
                "FROM langchain_pg_embedding "
                "WHERE tsv @@ websearch_to_tsquery('english', :q) "
                "LIMIT :k"
            ),
            {"q": " ".join(terms), "k": limit},
        ).fetchall()


def ilike_chunk_rows(terms: list[str], limit: int) -> list[tuple]:
    """Fallback ILIKE any-term matching when FTS finds nothing."""
    like = " OR ".join([f"document ILIKE :t{i}" for i in range(len(terms))])
    params = {f"t{i}": f"%{w}%" for i, w in enumerate(terms)}
    params["k"] = limit
    with engine.begin() as conn:
        return conn.execute(
            sqltext(f"SELECT document, cmetadata FROM langchain_pg_embedding WHERE {like} LIMIT :k"),
            params,
        ).fetchall()


def delete_page_vectors(page_id: str) -> None:
    """Prune cached vectors for a page (LangChain PGVector table)."""
    with engine.begin() as conn:
        conn.execute(
            sqltext("DELETE FROM langchain_pg_embedding WHERE cmetadata->>'page_id' = :p"),
            {"p": page_id},
        )
