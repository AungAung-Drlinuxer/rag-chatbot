"""SQLAlchemy engine + session + DB init (vector extension, tables, column sync)."""
from __future__ import annotations

import logging

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import SETTINGS
from app.persistence.models import Base

logger = logging.getLogger("it-help-chatbot")

engine = create_engine(SETTINGS.database_url, future=True, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    """Ensure the `vector` extension + all tables exist, then sync schema (idempotent)."""
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
    _sync_columns()
    _ensure_fts_index()


def _sync_columns() -> None:
    """Best-effort column migration: create_all() never ALTERs an existing table,
    so a DB created by an older release misses columns the model now declares
    (e.g. users.status, chat_sessions.title/is_pinned, user_settings.prefs).
    Add any model column that is missing from its live table (per-column
    best-effort so one bad DEFAULT never blocks the rest).
    """
    import re

    try:
        insp = inspect(engine)
        live_tables = set(insp.get_table_names())
    except Exception as exc:
        logger.warning(f"column sync skipped ({type(exc).__name__}): {exc}")
        return
    for table in Base.metadata.sorted_tables:
        if table.name not in live_tables:
            continue  # created whole by create_all — already complete
        try:
            have = {c["name"] for c in inspect(engine).get_columns(table.name)}
        except Exception as exc:  # table vanished / perms — skip it, keep going
            logger.debug("column sync: %s introspection skipped (%s)", table.name, exc)
            continue
        for col in table.columns:
            if col.name in have:
                continue
            try:
                coltype = col.type.compile(engine.dialect)
                stmt = f'ALTER TABLE {table.name} ADD COLUMN IF NOT EXISTS "{col.name}" {coltype}'
                if col.server_default is not None:
                    arg = col.server_default.arg
                    try:
                        dv = str(arg.compile(dialect=engine.dialect))
                    except Exception:
                        dv = str(arg)
                    # Bare words compile unquoted and read as column references
                    # ("DEFAULT Active" → FeatureNotSupported); quote plain literals.
                    if (
                        re.fullmatch(r"[A-Za-z_][A-Za-z0-9_ ]*", dv)
                        and dv.upper() not in {"NULL", "TRUE", "FALSE"}
                    ):
                        dv = f"'{dv}'"
                    stmt += f" DEFAULT {dv}"
                with engine.begin() as conn:
                    conn.execute(text(stmt))
                logger.info("schema: added missing column %s.%s", table.name, col.name)
            except Exception as exc:
                logger.warning(
                    "schema: %s.%s add skipped (%s): %s",
                    table.name, col.name, type(exc).__name__, exc,
                )


def _ensure_fts_index() -> None:
    """v0.10.0 hybrid search: FTS tsvector column + index over the LangChain PGVector
    chunk table (best-effort — the table only exists after the first ingestion)."""
    try:
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
        logger.warning(f"FTS index skipped ({type(exc).__name__}): {exc}")


def get_session() -> Session:
    return SessionLocal()
