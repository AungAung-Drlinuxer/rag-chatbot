"""JWT handlers (python-jose) — access + refresh tokens, HS256."""
from __future__ import annotations

import datetime as dt

from jose import jwt

from app.config import SETTINGS

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
