from __future__ import annotations

import logging

from app.schemas import LoginRequest, RefreshRequest

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.deps import get_current_user
from app.auth.jwt import create_access_token, create_refresh_token
from app.auth.ldap_auth import authenticate
from app.auth.rbac import allowed_domains, get_role, require_cap
from app.config import SETTINGS
from app.observability.audit import audit
from app.persistence.models import UserSettings

logger = logging.getLogger("auth")

router = APIRouter()

_require_chatbot = require_cap("chatbot")

@router.post("/api/auth/login")
def login(req: LoginRequest) -> dict:
    """LDAP/AD authenticate (Phase 5) → JWT access + refresh tokens (dev fallback: dev/dev)."""
    subject = authenticate(req.username, req.password)
    if not subject:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    # v0.21.99 — admin-disabled accounts get a dedicated 403 (NOT the misleading
    # 401 "Invalid credentials"): AD bind succeeded, so the password was correct —
    # the account itself is blocked.
    if subject.startswith("disabled:"):
        who = subject.split(":", 1)[1]
        logger.warning("login refused: %s is disabled", who)
        raise HTTPException(
            status_code=403,
            detail="Your account has been disabled by an administrator. Please contact IT.",
        )
    # v0.21.96 — LDAP registration gate: identity verified but account not yet
    # approved by an administrator → complete login is refused with a clear reason.
    if subject.startswith("pending:"):
        who = subject.split(":", 1)[1]
        raise HTTPException(
            status_code=403,
            detail=("Registration pending — your AD account was verified, but an "
                    "administrator must approve it on the Users page before you can "
                    "sign in. (Requested as " + who + ")"),
        )
    # v0.21.57 — hard block at login for admin-disabled users (covers the dev
    # backdoor path too, which bypasses the LDAP upsert check).
    from app.auth.rbac import is_disabled
    if is_disabled(subject):
        logger.warning("login refused: %s is disabled", subject)
        raise HTTPException(
            status_code=403,
            detail="Your account has been disabled by an administrator. Please contact IT.",
        )
    # v0.21.58 — record the real login time (Users page 'Last login' column)
    try:
        from sqlalchemy import text as _lt

        from app.persistence.database import SessionLocal as _SL

        with _SL() as _s:
            _s.execute(_lt(
                "INSERT INTO users (username, last_login) VALUES (:u, NOW()) "
                "ON CONFLICT (username) DO UPDATE SET last_login = NOW(), last_seen = NOW()"
            ), {"u": subject})
            _s.commit()
    except Exception as _e:
        logger.warning("last_login update skipped: %s", _e)
    audit("login", subject)
    return {
        "access_token": create_access_token(subject),
        "refresh_token": create_refresh_token(subject),
        "token_type": "bearer",
        "username": subject,
    }


@router.post("/api/auth/refresh")
def refresh_token(req: RefreshRequest) -> dict:
    """Exchange a valid refresh token for a new access token (v0.18.1)."""
    from app.auth.jwt import create_access_token, decode_token

    try:
        subject = decode_token(req.refresh_token, expected_type="refresh")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    # v0.21.50 — also block refresh for disabled users
    try:
        from sqlalchemy import text as _t
        from app.persistence.database import SessionLocal
        with SessionLocal() as s:
            row = s.execute(_t("SELECT status FROM users WHERE username = :u"), {"u": subject}).first()
        if row and row[0] == "Disabled":
            raise HTTPException(
                status_code=403,
                detail="Account is disabled — please contact your administrator",
            )
    except HTTPException:
        raise
    except Exception:
        pass
    return {"access_token": create_access_token(subject), "username": subject}


@router.get("/api/auth/me")
def me(user: str = Depends(get_current_user)) -> dict:
    """Current user + RBAC role (Phase 9) — lets the client show/hide admin UI.

    v0.21.57 — role now honours the admin-set role_override, and we return the
    resolved capability map + display role so the frontend can gate navigation and
    explain *why* something is blocked ("Your role (User) cannot create tickets").
    """
    from app.auth.rbac import (
        CAPABILITIES,
        _MATRIX_ROLE_FOR,
        effective_role,
        permissions_for,
    )

    role = effective_role(user)
    perms = permissions_for(user)
    return {
        "username": user,
        "role": role,
        "displayRole": _MATRIX_ROLE_FOR.get(role, "User"),
        "permissions": perms,
        "capabilityLabels": CAPABILITIES,
    }


# v0.21.57 — capability-gated endpoints give a clear 403 the UI can show
_require_chatbot = require_cap("chatbot")


def _serialize_user_settings(s: UserSettings) -> dict:
    return {
        "username": s.username,
        "theme": s.theme,
        "density": s.density,
        "chat_font_size": s.chat_font_size,
        "code_font": s.code_font,
        "show_token_usage": s.show_token_usage,
        "show_rag_sources": s.show_rag_sources,
        "stream_responses": s.stream_responses,
        "markdown_rendering": s.markdown_rendering,
        "auto_escalate_on_caution": s.auto_escalate_on_caution,
        "history_retention_days": s.history_retention_days,
        "escalate_include_transcript": s.escalate_include_transcript,
        "escalate_include_sources": s.escalate_include_sources,
        "escalate_open_new_tab": s.escalate_open_new_tab,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


_USER_SETTABLE_FIELDS = {
    "theme", "density", "chat_font_size", "code_font",
    "show_token_usage", "show_rag_sources", "stream_responses",
    "markdown_rendering", "auto_escalate_on_caution",
    "history_retention_days",
    "escalate_include_transcript", "escalate_include_sources",
    "escalate_open_new_tab",
}


@router.get("/api/settings")
def get_my_settings(user: str = Depends(get_current_user)) -> dict:
    """Return the current user's preferences (creating the row on first read).

    v0.22.2 — merges the ORM columns (theme, density, …) with the free-form
    `prefs` JSONB blob the SettingsPage saves (darkMode, appName, …). Prefs
    win on conflicts. Previously this endpoint only serialized the ORM columns,
    so the saved darkMode was invisible on session restore and the theme reset
    to light on every relogin.
    """
    import json as _json
    from sqlalchemy import text as _t
    from app.persistence.database import SessionLocal

    s = SessionLocal()
    try:
        row = s.get(UserSettings, user)
        if row is None:
            row = UserSettings(username=user)
            s.add(row)
            s.commit()
            s.refresh(row)
        out = _serialize_user_settings(row)
        prefs_row = s.execute(
            _t("SELECT prefs FROM user_settings WHERE username = :u"), {"u": user}
        ).first()
        prefs = prefs_row[0] if prefs_row else {}
        if isinstance(prefs, str):
            try:
                prefs = _json.loads(prefs)
            except Exception:
                prefs = {}
        if isinstance(prefs, dict):
            out.update(prefs)  # prefs blob wins over ORM defaults
        return out
    finally:
        s.close()


@router.put("/api/settings")
def update_my_settings(payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Merge-update the current user's preferences. Unknown fields are ignored."""
    from app.persistence.database import SessionLocal

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be a JSON object")
    s = SessionLocal()
    try:
        row = s.get(UserSettings, user)
        if row is None:
            row = UserSettings(username=user)
            s.add(row)
        for k, v in payload.items():
            if k in _USER_SETTABLE_FIELDS and v is not None:
                setattr(row, k, v)
        s.commit()
        s.refresh(row)
        return _serialize_user_settings(row)
    finally:
        s.close()

