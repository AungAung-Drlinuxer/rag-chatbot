"""SQLAlchemy engine + session + DB init (vector extension, tables)."""
from __future__ import annotations

import logging

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import SETTINGS
from app.persistence.models import Base

logger = logging.getLogger("it-help-chatbot")

engine = create_engine(SETTINGS.database_url, future=True, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    """Ensure `vector` extension exists, then create all tables (idempotent)."""
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
    # Best-effort column migration on already-created tables (create_all won't ALTER).
    try:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS meta TEXT"))
            conn.execute(text("ALTER TABLE kb_meta ADD COLUMN IF NOT EXISTS body TEXT"))
            conn.execute(text("ALTER TABLE kb_meta ADD COLUMN IF NOT EXISTS updated_by VARCHAR(64)"))
            conn.execute(text("ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS subject VARCHAR(200)"))
            conn.execute(text("ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS description TEXT"))
            conn.execute(text("ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS priority VARCHAR(16)"))
            conn.execute(text("ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS assignee VARCHAR(64)"))
            conn.execute(text("ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ"))
            conn.execute(text("CREATE TABLE IF NOT EXISTS ticket_comments (id BIGSERIAL PRIMARY KEY, ticket_id BIGINT NOT NULL, author VARCHAR(64), body TEXT NOT NULL, kind VARCHAR(16) DEFAULT 'comment', created_at TIMESTAMPTZ DEFAULT now())"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ticket_comments_ticket ON ticket_comments(ticket_id)"))
            conn.execute(text("CREATE TABLE IF NOT EXISTS ticket_attachments (id BIGSERIAL PRIMARY KEY, ticket_id BIGINT NOT NULL, filename VARCHAR(255) NOT NULL, content_type VARCHAR(128), data BYTEA NOT NULL, size_bytes BIGINT NOT NULL, created_by VARCHAR(64), created_at TIMESTAMPTZ DEFAULT now())"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ticket_attachments_ticket ON ticket_attachments(ticket_id)"))
            conn.commit()
        # v0.10.0 hybrid search: FTS index over pgvector chunk text (best-effort).
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE langchain_pg_embedding ADD COLUMN IF NOT EXISTS tsv tsvector"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS langchain_pg_embedding_tsv_idx "
                "ON langchain_pg_embedding USING gin (tsv)"
            ))
            # backfill tsv for rows that don't have it yet
            conn.execute(text(
                "UPDATE langchain_pg_embedding SET tsv = to_tsvector('english', document) "
                "WHERE tsv IS NULL"
            ))
    except Exception as exc:
        logger.warning(f"meta/FTS migration skipped ({type(exc).__name__}): {exc}")


def get_session() -> Session:
    return SessionLocal()
