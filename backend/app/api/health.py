"""Health/readiness endpoints."""
from __future__ import annotations

from fastapi import APIRouter

from app.core.config import SETTINGS

router = APIRouter(tags=["health"])

APP_VERSION = "0.2.0"


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "env": SETTINGS.app_env,
        "version": APP_VERSION,
        "conf_threshold": SETTINGS.confidence_gate_threshold,
    }
