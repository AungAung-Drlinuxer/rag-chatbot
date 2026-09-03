"""Shared HTTP error helpers — uniform error shapes for the API layer."""
from __future__ import annotations

from fastapi import HTTPException


def not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=404, detail=detail)


def unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(status_code=401, detail=detail)


def forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=403, detail=detail)


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def unavailable(service: str, exc: Exception | None = None) -> HTTPException:
    """503 for downstream subsystem failures (never leak internals)."""
    suffix = f": {type(exc).__name__}" if exc else ""
    return HTTPException(status_code=503, detail=f"{service} unavailable{suffix}")
