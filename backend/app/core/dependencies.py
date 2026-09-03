"""Shared FastAPI dependencies (auth guards + DB session) for the API layer."""
from __future__ import annotations

from collections.abc import Iterator

from app.auth.deps import get_current_user
from app.auth.rbac import (
    allowed_domains,
    get_role,
    is_disabled,
    jira_route,
    require_cap,
    require_role,
)
from app.core.security import decode_token  # noqa: F401  (re-export)
from app.persistence.database import SessionLocal


def get_db() -> Iterator[SessionLocal]:
    """Yield a SQLAlchemy session; always closed after the request."""
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


# Capability-gated chatbot access (used by the chat router).
require_chatbot = require_cap("chatbot")

__all__ = [
    "allowed_domains",
    "get_current_user",
    "get_db",
    "get_role",
    "is_disabled",
    "jira_route",
    "require_cap",
    "require_chatbot",
    "require_role",
]
