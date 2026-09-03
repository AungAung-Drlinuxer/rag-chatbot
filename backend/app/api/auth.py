"""Auth HTTP routes — login, refresh, current identity (delegates to auth.service)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import service
from app.auth.rbac import _MATRIX_ROLE_FOR, CAPABILITIES, effective_role, permissions_for
from app.core.dependencies import get_current_user
from app.observability.audit import audit
from app.schemas import LoginRequest, RefreshRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(req: LoginRequest) -> dict:
    """LDAP/AD authenticate (Phase 5) → JWT access + refresh tokens (dev fallback: dev/dev)."""
    result = service.login(req.username, req.password)
    audit("login", result["username"])
    return result


@router.post("/refresh")
def refresh_token(req: RefreshRequest) -> dict:
    """Exchange a valid refresh token for a new access token (v0.18.1)."""
    return service.refresh(req.refresh_token)


@router.get("/me")
def me(user: str = Depends(get_current_user)) -> dict:
    """Current user + RBAC role (Phase 9) — lets the client show/hide admin UI.

    v0.21.57 — role now honours the admin-set role_override, and we return the
    resolved capability map + display role so the frontend can gate navigation and
    explain *why* something is blocked ("Your role (User) cannot create tickets").
    """
    role = effective_role(user)
    return {
        "username": user,
        "role": role,
        "displayRole": _MATRIX_ROLE_FOR.get(role, "User"),
        "permissions": permissions_for(user),
        "capabilityLabels": CAPABILITIES,
    }
