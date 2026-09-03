"""Auth-specific request/response schemas."""
from __future__ import annotations

from app.schemas import LoginRequest, RefreshRequest, StrictModel


class TokenPair(StrictModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    username: str


class MeResponse(StrictModel):
    username: str
    role: str
    displayRole: str
    permissions: dict
    capabilityLabels: dict


__all__ = ["LoginRequest", "MeResponse", "RefreshRequest", "TokenPair"]
