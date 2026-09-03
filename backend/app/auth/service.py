"""Auth service — use-case orchestration over ldap/rbac/security.

Keeps HTTP concerns out of the subsystem: the API router calls these functions
and translates their result into responses/errors.
"""
from __future__ import annotations

import logging

from app.auth.ldap import authenticate
from app.auth.rbac import is_disabled
from app.core.exceptions import forbidden, unauthorized
from app.core.security import create_access_token, create_refresh_token, decode_token

logger = logging.getLogger("auth")


def login(username: str, password: str) -> dict:
    """Authenticate (LDAP/AD or dev fallback) and mint a token pair.

    Raises HTTPException on: invalid credentials (401), pending approval (403),
    admin-disabled account (403). Records `last_login` best-effort (v0.21.58).
    """
    subject = authenticate(username, password)
    if not subject:
        raise unauthorized("Invalid credentials")
    # v0.21.96 — LDAP registration gate: identity verified but account not yet
    # approved by an administrator → complete login is refused with a clear reason.
    if subject.startswith("pending:"):
        who = subject.split(":", 1)[1]
        raise forbidden(
            "Registration pending — your AD account was verified, but an "
            "administrator must approve it on the Users page before you can "
            "sign in. (Requested as " + who + ")"
        )
    # v0.21.57 — hard block at login for admin-disabled users (covers the dev
    # backdoor path too, which bypasses the LDAP upsert check).
    if is_disabled(subject):
        logger.warning("login refused: %s is disabled", subject)
        raise forbidden("Your account has been disabled by an administrator. Please contact IT.")
    _record_last_login(subject)
    return {
        "access_token": create_access_token(subject),
        "refresh_token": create_refresh_token(subject),
        "token_type": "bearer",
        "username": subject,
    }


def refresh(refresh_token: str) -> dict:
    """Exchange a valid refresh token for a new access token (v0.18.1)."""
    try:
        subject = decode_token(refresh_token, expected_type="refresh")
    except Exception:
        raise unauthorized("Invalid or expired refresh token")
    # v0.21.50 — also block refresh for disabled users (is_disabled is
    # best-effort: DB errors never block the refresh path).
    if is_disabled(subject):
        raise forbidden("Account is disabled — please contact your administrator")
    return {"access_token": create_access_token(subject), "username": subject}


def _record_last_login(username: str) -> None:
    from sqlalchemy import text

    from app.persistence.database import SessionLocal

    try:
        with SessionLocal() as s:
            s.execute(text(
                "INSERT INTO users (username, last_login) VALUES (:u, NOW()) "
                "ON CONFLICT (username) DO UPDATE SET last_login = NOW(), last_seen = NOW()"
            ), {"u": username})
            s.commit()
    except Exception as exc:
        logger.warning("last_login update skipped: %s", exc)
