from __future__ import annotations

from fastapi import APIRouter
from app.config import SETTINGS

router = APIRouter()

@router.get("/health")
def health() -> dict:
    return {"status": "ok", "env": SETTINGS.app_env, "conf_threshold": SETTINGS.confidence_gate_threshold}
