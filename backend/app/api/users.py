"""User + admin settings routes — preferences, RAG-tuning overrides, integration status."""
from __future__ import annotations

import logging
import os
import re

from fastapi import APIRouter, Depends, HTTPException

from app.core.dependencies import get_current_user, require_role
from app.observability.audit import audit
from app.persistence.repositories import users as users_repo

logger = logging.getLogger("it-help-chatbot")

router = APIRouter(tags=["users"])


@router.get("/api/settings")
def get_my_settings(user: str = Depends(get_current_user)) -> dict:
    """Return the current user's preferences (creating the row on first read)."""
    return users_repo.get_or_create(user)


@router.put("/api/settings")
def update_my_settings(payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Merge-update the current user's preferences. Unknown fields are ignored."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be a JSON object")
    return users_repo.merge_update(user, payload)


@router.get("/api/admin/settings")
def get_admin_settings(user: str = Depends(get_current_user),
                       role: str = Depends(require_role("admin"))) -> dict:
    """RAG-tuning overrides (admin only). Returns metadata for the UI."""
    from app.core.runtime import metadata as runtime_metadata
    return {"knobs": runtime_metadata()}


@router.put("/api/admin/settings")
def update_admin_settings(payload: dict, user: str = Depends(get_current_user),
                          role: str = Depends(require_role("admin"))) -> dict:
    """Apply one or more RAG-tuning overrides. Takes effect on the next request."""
    from app.core.runtime import metadata as runtime_metadata
    from app.core.runtime import set_ as runtime_set

    if not isinstance(payload, dict) or not isinstance(payload.get("knobs"), dict):
        raise HTTPException(status_code=400, detail="payload must be {\"knobs\": {key: value, ...}}")
    applied = {}
    for k, v in payload["knobs"].items():
        try:
            runtime_set(k, v)
            applied[k] = v
        except KeyError:
            continue  # silently skip non-whitelisted keys
    audit("settings_update", user, detail=f"knobs={list(applied.keys())}")
    return {"applied": applied, "knobs": runtime_metadata()}


@router.delete("/api/admin/settings/{key}")
def reset_admin_setting(key: str, user: str = Depends(get_current_user),
                        role: str = Depends(require_role("admin"))) -> dict:
    """Reset a RAG-tuning override back to the env default."""
    from app.core.runtime import reset as runtime_reset
    try:
        runtime_reset(key)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown key: {key}")
    audit("settings_reset", user, detail=f"key={key}")
    return {"reset": key}


def _secret_status(value: str | None) -> str:
    """Never expose secret values — only the meta state."""
    if value is None or value == "":
        return "missing"
    if value.startswith("REPLACE_ME"):
        return "placeholder"
    return "set"


@router.get("/api/integrations/status")
def integrations_status(user: str = Depends(get_current_user)) -> dict:
    """Integration status grid for the Settings panel — values never exposed."""
    from app.core.config import SETTINGS as S
    from app.core.runtime import metadata as runtime_metadata
    return {
        "llm": {
            "provider": S.hchat_provider,
            "model": S.hchat_model,
            "base_url": S.hchat_base_url,
            "api_key": _secret_status(os.environ.get("H_CHAT_API_KEY") or S.hchat_api_key),
        },
        "ollama": {
            "url": S.ollama_url,
            "embedding_model": S.embedding_model,
            "embedding_dim": S.embedding_dim,
        },
        "postgres": {
            "url": re.sub(r"://([^:/@]+):[^@/]+@", r"://\1:***@", S.database_url),
            "cnpg_cluster": "postgres-ha",
        },
        "redis": {
            "url": S.redis_url,
            "mode": S.redis_mode,
            "sentinels": S.redis_sentinels,
            "master_name": S.redis_master_name,
            "password": _secret_status(S.redis_password),
        },
        "jira": {
            "base_url": S.jira_base_url,
            "project": S.jira_project,
            "token": _secret_status(os.environ.get("JIRA_TOKEN") or S.jira_token),
            "routing": S.domain_jira_routing,
        },
        "confluence": {
            "base_url": S.confluence_base_url,
            "space_keys": S.confluence_space_keys,
            "token": _secret_status(os.environ.get("CONFLUENCE_TOKEN") or S.confluence_token),
        },
        "ldap": {
            "url": S.ldap_url,
            "base_dn": S.ldap_base_dn,
            "user_filter": S.ldap_user_filter,
            "bind_password": _secret_status(os.environ.get("LDAP_BIND_PASSWORD") or S.ldap_bind_password),
        },
        "observability": {
            "tempo": S.tempo_otlp_url or "not configured",
            "mimir": S.mimir_otlp_url or "not configured",
            "loki": S.loki_url or "not configured",
        },
        "runtime_overrides": runtime_metadata(),
        "app": {
            "version": "0.2.0",
            "env": S.app_env,
            "service": S.service_name,
        },
    }
