"""Security primitives — JWT issue/verify (python-jose, HS256) + password hashing.

Cross-cutting infra (GOVERNANCE core/): tokens/credentials helpers that both
the auth subsystem and the API layer depend on.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import secrets

from jose import jwt

from app.core.config import SETTINGS

_ALG = [SETTINGS.jwt_algorithm]


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def create_access_token(subject: str) -> str:
    payload = {
        "sub": subject,
        "type": "access",
        "iat": _now(),
        "exp": _now() + dt.timedelta(minutes=SETTINGS.access_token_minutes),
    }
    return jwt.encode(payload, SETTINGS.jwt_secret, algorithm=SETTINGS.jwt_algorithm)


def create_refresh_token(subject: str) -> str:
    payload = {
        "sub": subject,
        "type": "refresh",
        "iat": _now(),
        "exp": _now() + dt.timedelta(days=SETTINGS.refresh_token_days),
    }
    return jwt.encode(payload, SETTINGS.jwt_secret, algorithm=SETTINGS.jwt_algorithm)


def decode_token(token: str, expected_type: str = "access") -> str:
    """Return the subject (username) or raise on invalid/expired/mistyped token.

    v0.18.1 — enforces the token `type` claim so a refresh token can never be
    replayed as an access token (and vice versa).
    """
    payload = jwt.decode(token, SETTINGS.jwt_secret, algorithms=_ALG)
    if payload.get("type") != expected_type:
        raise ValueError("wrong token type")
    return payload["sub"]


# --- local (non-LDAP) password hashing (PBKDF2-HMAC-SHA256) -----------------
def hash_password(password: str) -> str:
    """Return `salt$digest` for storage in local_user_credentials."""
    salt = secrets.token_hex(16)
    digest = hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    if not stored or "$" not in stored:
        return False
    salt, digest = stored.split("$", 1)
    candidate = hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(candidate, digest)
