"""User settings persistence (owned by persistence/)."""
from __future__ import annotations

from app.persistence.database import SessionLocal
from app.persistence.models import UserSettings

USER_SETTABLE_FIELDS = {
    "theme", "density", "chat_font_size", "code_font",
    "show_token_usage", "show_rag_sources", "stream_responses",
    "markdown_rendering", "auto_escalate_on_caution",
    "history_retention_days",
    "escalate_include_transcript", "escalate_include_sources",
    "escalate_open_new_tab",
}

_FIELDS = (
    "username", "theme", "density", "chat_font_size", "code_font",
    "show_token_usage", "show_rag_sources", "stream_responses",
    "markdown_rendering", "auto_escalate_on_caution",
    "history_retention_days", "escalate_include_transcript",
    "escalate_include_sources", "escalate_open_new_tab",
)


def serialize(row: UserSettings) -> dict:
    out = {f: getattr(row, f) for f in _FIELDS}
    out["updated_at"] = row.updated_at.isoformat() if row.updated_at else None
    return out


def get_or_create(username: str) -> dict:
    """Return the user's preferences, creating the row on first read."""
    with SessionLocal() as s:
        row = s.get(UserSettings, username)
        if row is None:
            row = UserSettings(username=username)
            s.add(row)
            s.commit()
            s.refresh(row)
        return serialize(row)


def merge_update(username: str, payload: dict) -> dict:
    """Merge-update the user's preferences. Unknown fields are ignored."""
    with SessionLocal() as s:
        row = s.get(UserSettings, username)
        if row is None:
            row = UserSettings(username=username)
            s.add(row)
        for k, v in payload.items():
            if k in USER_SETTABLE_FIELDS and v is not None:
                setattr(row, k, v)
        s.commit()
        s.refresh(row)
        return serialize(row)
