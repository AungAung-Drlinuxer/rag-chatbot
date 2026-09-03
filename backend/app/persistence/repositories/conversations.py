"""Conversation persistence — sessions + messages (owned by persistence/)."""
from __future__ import annotations

import json
import uuid as _uuid
from typing import Any

from sqlalchemy import func

from app.persistence.database import SessionLocal
from app.persistence.models import ChatMessage, ChatSession


def _parse_sid(session_id: str):
    try:
        return _uuid.UUID(session_id)
    except (ValueError, AttributeError, TypeError):
        return None


def recent(username: str, limit: int = 20) -> list[dict]:
    """Recent conversations for `username` (pinned first, then newest)."""
    s = SessionLocal()
    try:
        rows = (
            s.query(
                ChatSession.id,
                func.max(ChatMessage.created_at).label("last_at"),
                func.count(ChatMessage.id).label("messages"),
                ChatSession.title,
                ChatSession.is_pinned,
            )
            .join(ChatMessage, ChatMessage.session_id == ChatSession.id)
            .filter(ChatSession.username == username)
            .group_by(ChatSession.id)
            .order_by(ChatSession.is_pinned.desc(), func.max(ChatMessage.created_at).desc(), ChatSession.id)
            .limit(limit)
            .all()
        )
        convs = []
        for r in rows:
            first = (
                s.query(ChatMessage.content)
                .filter(ChatMessage.session_id == r[0], ChatMessage.role == "user")
                .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
                .first()
            )
            fallback = (first[0][:80] + "…") if first and len(first[0]) > 80 else (first[0] if first else "New conversation")
            session_title = r[3]
            title = (session_title[:80] + "…") if session_title and len(session_title) > 80 else (session_title or fallback)
            convs.append({
                "session_id": str(r[0]),
                "title": title,
                "last_at": r[1].isoformat() if r[1] else None,
                "messages": r[2],
                "is_pinned": bool(r[4]),
            })
        return convs
    finally:
        s.close()


def owned_session(session_id: str, username: str):
    """Return the ChatSession if it exists and belongs to `username`, else None.

    Also returns the parsed uuid so callers avoid a second parse. Raises ValueError
    for a malformed session id.
    """
    sid = _uuid.UUID(session_id)
    s = SessionLocal()
    try:
        sess = s.get(ChatSession, sid)
        if sess is None or sess.username != username:
            return None, sid
        return sess, sid
    finally:
        s.close()


def messages(session_id: str, username: str, caution_builder) -> list[dict]:
    """Full message history for an owned session; None if not owned/found.

    `caution_builder` is called with the parsed meta so the caller (chat policy)
    owns how a caution message is rendered — persistence just supplies the rows.
    """
    sid = _uuid.UUID(session_id)
    s = SessionLocal()
    try:
        sess = s.get(ChatSession, sid)
        if sess is None or sess.username != username:
            return None  # type: ignore[return-value]
        rows = (
            s.query(ChatMessage)
            .filter(ChatMessage.session_id == sid)
            .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            .all()
        )
        out = []
        for m in rows:
            meta = None
            caution = None
            if m.role == "assistant" and m.meta:
                try:
                    meta = json.loads(m.meta)
                except (ValueError, TypeError):
                    meta = None
                if meta and meta.get("decision") == "caution":
                    caution = caution_builder()
            out.append({
                "role": m.role,
                "content": m.content,
                "meta": meta,
                "caution": caution,
                "message_id": str(m.id),
            })
        return out
    finally:
        s.close()


def update(session_id: str, username: str, *, title: Any = ..., is_pinned: Any = ...) -> dict | None:
    """Rename / pin a conversation (owner only). Returns the new state, or None."""
    sid = _uuid.UUID(session_id)
    with SessionLocal() as s:
        sess = s.get(ChatSession, sid)
        if sess is None or sess.username != username:
            return None
        if title is not ...:
            clean = (title or "").strip()[:200]
            sess.title = clean or None
        if is_pinned is not ...:
            sess.is_pinned = bool(is_pinned)
        s.commit()
    return {"title": sess.title, "is_pinned": sess.is_pinned}


def clear_all(username: str) -> int:
    """Delete every conversation (and messages) for a user. Returns count deleted."""
    s = SessionLocal()
    try:
        ids = [r[0] for r in s.query(ChatSession.id).filter(ChatSession.username == username).all()]
        if ids:
            s.query(ChatMessage).filter(ChatMessage.session_id.in_(ids)).delete(synchronize_session=False)
            s.query(ChatSession).filter(ChatSession.id.in_(ids)).delete(synchronize_session=False)
            s.commit()
        return len(ids)
    finally:
        s.close()


def delete_one(session_id: str, username: str) -> bool:
    """Delete ONE owned conversation (cascades messages). True if it existed."""
    sid = _uuid.UUID(session_id)
    s = SessionLocal()
    try:
        row = s.get(ChatSession, sid)
        if not row or row.username != username:
            return False
        s.query(ChatMessage).filter(ChatMessage.session_id == sid).delete(synchronize_session=False)
        s.delete(row)
        s.commit()
        return True
    finally:
        s.close()


def ensure_session(session_id: str, username: str):
    """Create the session row if absent (FK-safe). Returns an open session."""
    s = SessionLocal()
    sess = s.get(ChatSession, session_id)
    if sess is None:
        sess = ChatSession(id=session_id, username=username)
        s.add(sess)
        s.flush()
    return s


def append_message(session, *, session_id: str, role: str, content: str, meta: str | None = None):
    """Persist a single turn on the given (already open) session."""
    msg = ChatMessage(session_id=session_id, role=role, content=content)
    if meta is not None:
        msg.meta = meta
    session.add(msg)
    session.commit()
    return msg
