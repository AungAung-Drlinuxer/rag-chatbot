from __future__ import annotations

import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import threading
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi import status as http_status
from pydantic import BaseModel
from sqlalchemy import text

from app.auth.deps import get_current_user
from app.auth.rbac import get_role, require_role, require_cap
from app.config import SETTINGS
from app.persistence.database import SessionLocal, engine

logger = logging.getLogger("dashboard")

from app.observability.audit import audit
from fastapi import UploadFile as _UPLOAD_FILE, File as _FILE, Form as _FORM

router = APIRouter(prefix="/api")

def _db() -> Any:
    return SessionLocal()

def _rows(sql: str, params: dict | None = None) -> list[dict]:
    """Run a read query and return list[dict]."""
    with engine.begin() as conn:
        result = conn.execute(text(sql), params or {})
        return [dict(m) for m in result.mappings()]

@router.get("/settings")
def get_user_settings(user: str = Depends(get_current_user)) -> dict:
    """Returns the current user's saved preferences as a flat key/value map."""
    import json as _json
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t(
            "SELECT prefs FROM user_settings WHERE username = :u"
        ), {"u": user}).first()
    prefs = row[0] if row and row[0] else {}
    if isinstance(prefs, str):
        try: prefs = _json.loads(prefs)
        except Exception: prefs = {}
    return {"settings": prefs or {}, "username": user}


@router.put("/settings")
def put_user_settings(payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Replace the current user's preferences (prefs JSONB column).
    Creates the row on first save with sensible defaults for all required
    columns. Requires the `prefs` JSONB column (added in v0.21.15)."""
    settings = payload.get("settings")
    if not isinstance(settings, dict):
        raise HTTPException(status_code=400, detail="settings must be an object")
    import json as _json
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        s.execute(_t(
            "INSERT INTO user_settings (username, theme, density, prefs) "
            "VALUES (:u, 'light', 'comfortable', :p) "
            "ON CONFLICT (username) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = NOW()"
        ), {"u": user, "p": _json.dumps(settings)})
        s.commit()
    return {"ok": True, "username": user, "count": len(settings)}

# === v0.21.37 — SMTP email notification settings (admin only) ===
SMTP_KEYS = {"host", "port", "username", "password", "from_address", "use_tls", "enabled", "alerts"}

def _require_admin(user: str) -> None:
    from app.auth.rbac import get_role
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: admin only")

@router.get("/settings/smtp")
def get_smtp_settings(user: str = Depends(get_current_user)) -> dict:
    _require_admin(user)
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'smtp'")).first()
    import json as _json
    val = row[0] if row else {}
    if isinstance(val, str):
        try: val = _json.loads(val)
        except Exception: val = {}
    # v1.6.35 — same write-only policy as the integrations: no stored value is
    # returned (host / username / from-address were being echoed verbatim, and the
    # smarthost account name is itself sensitive in most enterprises).
    from app.security.credentials import MASK, fields_set, redact_config

    val = val or {}
    set_keys = fields_set(val)
    return {
        "smtp": redact_config(val),
        "fields_set": set_keys,
        "mask": MASK,
        "configured": bool(set_keys),
        "password_set": bool(val.get("password")),
    }

@router.put("/settings/smtp")
def put_smtp_settings(payload: dict, user: str = Depends(get_current_user)) -> dict:
    _require_admin(user)
    data = payload.get("smtp")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="smtp object required")
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'smtp'")).first()
        import json as _json
        current = row[0] if row else {}
        if isinstance(current, str):
            try: current = _json.loads(current)
            except Exception: current = {}
        current = current or {}
        # merge; empty password keeps the existing one
        for k, v in data.items():
            if k in SMTP_KEYS:
                if k == "password" and not v:
                    continue
                current[k] = v
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES ('smtp', :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"v": _json.dumps(current)})
        s.commit()
    return {"ok": True}

@router.post("/settings/smtp/test")
def send_test_email(payload: dict, user: str = Depends(get_current_user)) -> dict:
    _require_admin(user)
    import smtplib, ssl as _ssl
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'smtp'")).first()
    import json as _json
    cfg = row[0] if row else {}
    if isinstance(cfg, str):
        try: cfg = _json.loads(cfg)
        except Exception: cfg = {}
    cfg = cfg or {}
    host = cfg.get("host"); port = int(cfg.get("port") or 587)
    username = cfg.get("username"); password = cfg.get("password")
    from_addr = cfg.get("from_address") or username
    to_addr = payload.get("to") or username
    if not host or not from_addr:
        raise HTTPException(status_code=400, detail="SMTP host or from address is not configured")
    msg = MIMEMultipart()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = "iTH Enterprise — Test email"
    msg.attach(MIMEText("SMTP configuration test successful. (iTH Enterprise Assistant)", "plain", "utf-8"))
    try:
        use_ssl = port == 465
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=15,
                                  context=_ssl.create_default_context()) as srv:
                if username and password:
                    srv.login(username, password)
                srv.sendmail(from_addr, [to_addr], msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=15) as srv:
                srv.ehlo()
                if cfg.get("use_tls", True):
                    srv.starttls(context=_ssl.create_default_context())
                    srv.ehlo()
                if username and password:
                    srv.login(username, password)
                srv.sendmail(from_addr, [to_addr], msg.as_string())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Send failed: {exc}")
    return {"ok": True, "to": to_addr}


# === v0.21.40 — integration settings (Confluence / Jira) ===
INTEGRATION_KEYS = {"confluence", "jira", "ldap", "keycloak", "llm", "redis", "ollama",
                    "openproject", "xwiki", "notion", "clickup", "mcp"}

def _reload_after_change(key: str) -> None:
    """Drop any in-process cache that mirrors the integration config we just wrote."""
    if key == "llm":
        from app.llm.client import reload_llm_cfg
        reload_llm_cfg()
    if key == "jira":
        from app.integrations.jira import reload_jira_cfg
        reload_jira_cfg()
    if key == "mcp":
        # The MCP client caches its session, tool catalogue and URL; drop it so the
        # next request picks up a new endpoint without a pod restart.
        from app.mcp import client as _mcp_client
        _mcp_client._client = None


@router.get("/settings/integrations/{key}")
def get_integration_settings(key: str, user: str = Depends(get_current_user)) -> dict:
    """Return the integration's configuration WITHOUT any stored value.

    v1.6.35 — WRITE-ONLY. The previous filter dropped only `*_token` / `*_password`,
    which leaked `api_key` (Models Provider), `client_secret` (Keycloak) and every
    identifier (`base_url`, `email`, `host`, `bind_dn`, ...) in plaintext — an admin
    token could read secrets straight back out.

    Nothing is echoed now: the client receives mask tokens plus `fields_set` /
    `secret_fields` so the UI can render "configured" without being able to recover
    the value. Confirming a configuration is done with the Test endpoint, which
    runs server-side.
    """
    if key not in INTEGRATION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown integration")

    import json as _json

    from app.security.credentials import (
        MASK,
        fields_set,
        redact_config,
        secret_fields_set,
    )

    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(
            _t("SELECT value, updated_at FROM system_settings WHERE key = :k"), {"k": key}
        ).first()

    val = row[0] if row else {}
    updated_at = row[1] if row else None
    if isinstance(val, str):
        try:
            val = _json.loads(val)
        except Exception:
            val = {}
    val = val or {}

    set_keys = fields_set(val)
    return {
        "integration": key,
        "configured": bool(set_keys),
        # every stored key is present but masked — no raw value ever leaves here
        "settings": redact_config(val),
        # the UI renders from these flags, never from a returned value
        "fields_set": set_keys,
        "secret_fields": secret_fields_set(val),
        "mask": MASK,
        "updated_at": updated_at.isoformat() if updated_at else None,
        # kept for older clients
        "token_set": bool(secret_fields_set(val)),
    }


@router.delete("/settings/integrations/{key}")
def delete_integration_settings(
    key: str, confirm: str = "", user: str = Depends(get_current_user)
) -> dict:
    """Remove a stored integration configuration entirely ("disconnect").

    v1.6.35 — needed because a credential is write-only: an empty field means
    "keep the stored value", so there was previously NO way for an admin to
    revoke a saved token through the API.
    """
    if key not in INTEGRATION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown integration")
    # Guard: this is unrecoverable (credentials are write-only, and there is no
    # settings backup), so require the caller to name the integration again.
    # `?confirm=<key>` prevents an accidental/scripted wipe of live config.
    if confirm != key:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Confirmation required: call DELETE /api/settings/integrations/{key}?confirm={key}. "
                "Removing an integration config cannot be undone and the stored credentials "
                "cannot be recovered."
            ),
        )
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        s.execute(_t("DELETE FROM system_settings WHERE key = :k"), {"k": key})
        s.commit()
    _reload_after_change(key)
    return {"ok": True, "integration": key, "cleared": True}


@router.put("/settings/integrations/{key}")
def put_integration_settings(key: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    if key not in INTEGRATION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown integration")
    data = payload.get("settings")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="settings object required")
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"), {"k": key}).first()
        import json as _json
        current = row[0] if row else {}
        if isinstance(current, str):
            try: current = _json.loads(current)
            except Exception: current = {}
        # v1.6.35 — central policy in app/security/credentials.py:
        #   mask echoed back -> refused (would destroy the real value)
        #   "__CLEAR__"      -> delete the field
        #   empty/absent     -> keep the stored value
        from app.security.credentials import apply_update
        current = apply_update(current, data)
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES (:k, :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"k": key, "v": _json.dumps(current)})
        s.commit()
    _reload_after_change(key)
    return {"ok": True}

@router.post("/settings/integrations/{key}/test")
def test_integration(key: str, user: str = Depends(get_current_user)) -> dict:
    """Connectivity test for Confluence / Jira."""
    import httpx
    from app.config import SETTINGS
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"), {"k": key}).first()
    import json as _json
    cfg = row[0] if row else {}
    if isinstance(cfg, str):
        try: cfg = _json.loads(cfg)
        except Exception: cfg = {}
    cfg = cfg or {}
    try:
        if key == "confluence":
            url = (cfg.get("base_url") or "").rstrip("/")
            if not url:
                raise ValueError("base_url not set")
            r = httpx.get(f"{url}/rest/api/content", params={"limit": 1},
                          auth=(cfg.get("email") or "", cfg.get("api_token") or ""), timeout=15)
            status = r.status_code
            detail = r.text[:200] if status not in (200, 201) else ""
        elif key == "jira":
            url = (cfg.get("base_url") or "").rstrip("/")
            if not url:
                raise ValueError("base_url not set")
            r = httpx.get(f"{url}/rest/api/3/myself",
                          auth=(cfg.get("email") or "", cfg.get("api_token") or ""), timeout=15)
            status = r.status_code
            detail = r.text[:200] if status != 200 else ""
        elif key == "llm":
            base = (cfg.get("base_url") or "").rstrip("/")
            if not base:
                raise ValueError("base_url not set")
            _key = cfg.get("api_key") or ""
            if not _key:
                raise ValueError("api_key not set — enter your provider API key and Save first")
            _hdrs = {"Authorization": f"Bearer {_key}"}
            r = httpx.get(f"{base}/models", headers=_hdrs, timeout=15)
            status = r.status_code
            detail = r.text[:200] if status != 200 else ""
        elif key == "ollama":
            host = (cfg.get("host") or "").rstrip("/")
            if not host:
                raise ValueError("host not set")
            r = httpx.get(f"{host}/api/tags", timeout=10)
            status = r.status_code
            detail = r.text[:200] if status != 200 else ""
        elif key == "redis":
            # TCP connect check (redis-ping needs a client dep; socket is enough)
            import socket
            host = cfg.get("host") or "127.0.0.1"
            port = int(cfg.get("port") or 6379)
            s = socket.create_connection((host, port), timeout=5)
            s.close()
            status, detail = 200, ""
        elif key == "ldap":
            # LDAP bind check via ldap3 using saved config (falls back to env config)
            from app.config import SETTINGS as _S
            host = cfg.get("host") or ""
            if not host:
                raise ValueError("host not set")
            port = int(cfg.get("port") or 389)
            from ldap3 import Server, Connection
            srv = Server(host, port=port, get_info=None, connect_timeout=5)
            conn = Connection(srv, user=cfg.get("bind_dn") or None,
                              password=cfg.get("bind_password") or None, auto_bind=False)
            conn.open()
            conn.unbind()
            status, detail = 200, ""
        elif key == "keycloak":
            # Keycloak SSO connectivity: OIDC discovery on the realm issuer
            issuer = (cfg.get("issuer") or cfg.get("base_url") or "").rstrip("/")
            if not issuer:
                raise ValueError("issuer not set")
            realm = cfg.get("realm") or "ith-chatbot"
            r = httpx.get(f"{issuer}/realms/{realm}/.well-known/openid-configuration", timeout=15)
            status = r.status_code
            detail = "" if r.status_code == 200 else r.text[:200]
        elif key == "openproject":
            from app.integrations.openproject import test_connection as _op_test
            result = _op_test()
            status = 200 if result.get("ok") else 502
            detail = result.get("message", "")
        elif key == "xwiki":
            from app.integrations.xwiki import test_connection as _xw_test
            result = _xw_test()
            status = 200 if result.get("ok") else 502
            detail = result.get("message", "")
        elif key == "notion":
            from app.integrations.notion import test_connection as _no_test
            result = _no_test()
            status = 200 if result.get("ok") else 502
            detail = result.get("message", "")
        elif key == "clickup":
            from app.integrations.clickup import test_connection as _cu_test
            result = _cu_test()
            status = 200 if result.get("ok") else 502
            detail = result.get("message", "")
        elif key == "mcp":
            # Live probe of the MCP server: handshake + tool catalogue. Reports the
            # curated subset so an admin can see the feature actually works rather
            # than just "reachable".
            from app.mcp import client as _mcp_client
            _mcp_client._client = None  # always test the CURRENT saved config
            cli = _mcp_client.get_client()
            cli.initialize()
            names = [t.get("name") for t in cli.list_tools()]
            from app.mcp.infra_agent import CURATED_TOOLS
            curated = [n for n in CURATED_TOOLS if n in names]
            detail = ("connected — %d tool(s) available, %d curated for the assistant"
                      % (len(names), len(curated)))
            result = {"ok": True, "message": detail,
                      "tools_available": len(names), "tools_curated": curated}
            status = 200
        else:
            raise ValueError(f"no test for {key}")
        if status in (200, 201):
            # Pass through any extra evidence the probe collected. MCP reports the
            # tool catalogue here, and dropping it made the Settings card claim
            # success while showing nothing about what was actually reachable.
            payload = {"ok": True, "status": status}
            if isinstance(result, dict):
                for k, v in result.items():
                    if k not in ("ok", "status"):
                        payload[k] = v
            if detail and "detail" not in payload:
                payload["detail"] = detail
            return payload
        return {"ok": False, "status": status, "detail": detail}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)[:200]}


@router.get("/settings/integrations/llm/models")
def list_llm_models(user: str = Depends(get_current_user)) -> dict:
    """Fetch the model catalogue from the configured provider (saved key required).

    Returns [{id, name}] sorted by id. Used by the Settings -> Integrations ->
    Models Provider model selector so admins pick from the provider's real list.
    """
    from app.auth.rbac import get_role as _get_role
    if _get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    import httpx
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'llm'")).first()
    import json as _json
    cfg = row[0] if row else {}
    if isinstance(cfg, str):
        try: cfg = _json.loads(cfg)
        except Exception: cfg = {}
    cfg = cfg or {}
    base = (cfg.get("base_url") or "").rstrip("/")
    key = cfg.get("api_key") or ""
    if not base:
        raise HTTPException(status_code=400, detail="Base URL not set — save the integration first.")
    if not key:
        raise HTTPException(status_code=400, detail="API key not set — save your provider API key first.")
    try:
        r = httpx.get(f"{base}/models", headers={"Authorization": f"Bearer {key}"}, timeout=20)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"provider unreachable: {exc}")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"provider error {r.status_code}: {r.text[:150]}")
    try:
        data = r.json()
        items = data.get("data", data if isinstance(data, list) else [])
        models = [{"id": m.get("id"), "name": m.get("name") or m.get("id")} for m in items if m.get("id")]
        models.sort(key=lambda m: m["id"].lower())
        return {"models": models, "count": len(models)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"unexpected provider response: {exc}")


# === v0.21.36 — chat attachments ===
# Store uploaded files (images/docs) as bytea rows; the chat message references
# attachment ids so the UI can render previews inline.


# === v0.22.0 — Branding: admin-customizable logo (login + sidebar) ===========
BRANDING_KEY = "branding"
_ALLOWED_MIME = {"image/png": "png", "image/jpeg": "jpg"}
_MAX_LOGO_BYTES = 2 * 1024 * 1024  # 2 MB


@router.get("/branding")
def get_branding() -> dict:
    """PUBLIC (no auth) — the login page needs the logo before any token exists.

    Returns { logo: data-url | None, appName: str | None, updated_at }.
    The data-url embeds the bytes, so the SPA can render it without a separate
    authenticated fetch.
    """
    import json as _json
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t(
            "SELECT value, updated_at FROM system_settings WHERE key = :k"
        ), {"k": BRANDING_KEY}).first()
    val = row[0] if row else None
    if isinstance(val, str):
        try: val = _json.loads(val)
        except Exception: val = {}
    val = val or {}
    return {
        "logo": val.get("logo") or None,          # data:image/png;base64,...
        "appName": val.get("appName") or None,
        "updated_at": str(row[1]) if row and row[1] else None,
    }


@router.put("/admin/branding/logo")
async def put_branding_logo(
    user: str = Depends(get_current_user),
    file: _UPLOAD_FILE = _FILE(...),
    appName: str = _FORM(None),
) -> dict:
    """ADMIN — upload a logo (multipart form). PNG/JPG <= 2 MB.

    Stored as a base64 data-url in system_settings.branding (replicated with
    the DB; no PVC needed). Remove with DELETE /admin/branding/logo.
    """
    _require_admin(user)
    import base64 as _b64

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > _MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="Logo exceeds 2 MB limit")
    mime = file.content_type or ""
    if mime not in _ALLOWED_MIME:
        raise HTTPException(status_code=415, detail="Only PNG and JPG images are allowed")
    # Magic-byte sniffing (content-type header can lie)
    if mime == "image/png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=415, detail="File is not a real PNG")
    if mime == "image/jpeg" and not data.startswith(b"\xff\xd8\xff"):
        raise HTTPException(status_code=415, detail="File is not a real JPEG")

    data_url = f"data:{mime};base64," + _b64.b64encode(data).decode()
    import json as _json
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"),
                        {"k": BRANDING_KEY}).first()
        cur = row[0] if row else {}
        if isinstance(cur, str):
            try: cur = _json.loads(cur)
            except Exception: cur = {}
        cur = cur or {}
        cur["logo"] = data_url
        if appName is not None:
            cur["appName"] = str(appName).strip() or None
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES (:k, :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"k": BRANDING_KEY, "v": _json.dumps(cur)})
        s.commit()
    audit("branding.logo.update", user, detail=f"mime={mime} bytes={len(data)}")
    return {"ok": True, "bytes": len(data), "mime": mime, "appName": cur.get("appName")}


@router.put("/admin/branding/app-name")
def put_branding_app_name(
    body: dict,
    user: str = Depends(get_current_user),
) -> dict:
    """ADMIN — set the brand name (optional) shown beside the logo.

    Body: {"appName": "My IT Help" | null}
    Empty string clears the override (falls back to "IT Help Chatbot").
    """
    _require_admin(user)
    name = body.get("appName")
    name = str(name).strip() if name is not None else None
    import json as _json
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"),
                        {"k": BRANDING_KEY}).first()
        cur = row[0] if row else {}
        if isinstance(cur, str):
            try: cur = _json.loads(cur)
            except Exception: cur = {}
        cur = cur or {}
        if name:
            cur["appName"] = name[:60]  # cap length
        else:
            cur.pop("appName", None)
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES (:k, :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"k": BRANDING_KEY, "v": _json.dumps(cur)})
        s.commit()
    audit("branding.appname.update", user, detail=f"appName={name or '(reset)'}")
    return {"ok": True, "appName": cur.get("appName")}


@router.delete("/admin/branding/logo")
def delete_branding_logo(user: str = Depends(get_current_user)) -> dict:
    """ADMIN — reset to the default built-in ITH mark."""
    _require_admin(user)
    import json as _json
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"),
                        {"k": BRANDING_KEY}).first()
        cur = row[0] if row else {}
        if isinstance(cur, str):
            try: cur = _json.loads(cur)
            except Exception: cur = {}
        cur = cur or {}
        cur.pop("logo", None)
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES (:k, :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"k": BRANDING_KEY, "v": _json.dumps(cur)})
        s.commit()
    audit("branding.logo.reset", user)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Connectors gallery (v1.6.74)
# ---------------------------------------------------------------------------
# A Perplexity-style connector screen needs three things this app did not have: a
# catalogue of what CAN be connected, the live state of each, and a way to connect one
# without editing a manifest. The catalogue lives in app/mcp/catalog.py; this module
# joins it to real state so the UI never has to guess.
#
# `status` is measured, never assumed: a connector is only "ready" when its MCP server
# actually answered a tool listing. That distinction matters — a card that says
# "Connected" while the server is down is the same class of lie as reporting a failed
# lookup as a success.


# Connector probe cache. A settings page must not block on network probes: measured
# 20.1s when every enabled server was probed inline, so the result is cached for 5
# minutes. Explicit "Test" bypasses the cache (the user is waiting for the truth there).
_STATE_CACHE: tuple = ()
_STATE_LOCK = threading.Lock()
_STATE_TTL = 300.0
_REFRESHING = False


def _invalidate_connector_cache() -> None:
    global _STATE_CACHE
    with _STATE_LOCK:
        _STATE_CACHE = ()


def _probe(spec: dict, timeout: float = 6.0) -> dict:
    """Ask one MCP server what it offers. Bounded, never raises."""
    from app.mcp.client import get_client
    from app.mcp.infra_agent import curated_for

    if not spec or not spec.get("enabled") or not spec.get("url"):
        return {"reachable": False, "tools": 0, "exposed": 0}
    out = {"reachable": False, "tools": 0, "exposed": 0}
    res: dict = {}

    def run():
        try:
            cli = get_client(spec["name"])
            cat = {t.get("name"): t for t in cli.list_tools()}
            res["tools"] = len(cat)
            res["exposed"] = len(curated_for(spec["name"], cat))
            res["reachable"] = True
        except Exception:  # noqa: BLE001
            res["reachable"] = False

    th = threading.Thread(target=run, daemon=True)
    th.start()
    th.join(timeout)
    if th.is_alive():
        # The connector is configured but slow to answer. Report it as not answering
        # rather than making the settings page wait on it.
        return out
    return {
        "reachable": bool(res.get("reachable")),
        "tools": int(res.get("tools") or 0),
        "exposed": int(res.get("exposed") or 0),
    }


def _unknown_state() -> dict:
    """Configured/enabled from settings, with reachability explicitly UNKNOWN.

    Tri-state on purpose: `null` means "not probed yet", `false` means "probed and it did
    not answer". Collapsing those two would make a working connector look broken on the
    first page load.
    """
    from app.mcp.catalog import CATALOG
    from app.mcp.client import get_mcp_cfg, get_mcp_servers

    cfg = get_mcp_cfg()
    servers = {x["name"]: x for x in get_mcp_servers()}
    out = {}
    for entry in CATALOG:
        cid = entry["id"]
        spec = servers.get(cid)
        out[cid] = {
            "configured": bool(spec) and (cid in ("rancher", "proxmox") or bool(cfg.get("servers"))),
            "enabled": bool(spec.get("enabled")) if spec else False,
            "reachable": None,
            "tools_available": 0,
            "tools_exposed": 0,
        }
    return out


def _connector_state(block: bool = False) -> dict:
    """Live state for every connector: configured, enabled, reachable, tool counts.

    MEASURED, never assumed — and CACHED. The first version probed every server inline
    and the settings page took 20.1s to load, which is not a settings page. Probes are
    now bounded to 6s each, run in parallel, and cached for 5 minutes; "Test" always
    probes fresh because that is the one place a user is waiting for the truth.
    """
    from app.mcp.catalog import CATALOG
    from app.mcp.client import get_mcp_cfg, get_mcp_servers

    global _STATE_CACHE, _REFRESHING  # declared once: Python requires it
    # before ANY use of the name in the function
    now = time.time()
    with _STATE_LOCK:
        cached = _STATE_CACHE[1] if _STATE_CACHE else None
        fresh = bool(_STATE_CACHE) and now - _STATE_CACHE[0] < _STATE_TTL
    if fresh:
        return cached

    # NOT fresh. Two replicas mean an in-process cache is never reliably warm, and the
    # probe takes ~6s, so blocking here made the settings page wait. Instead: return what
    # we have (or an honest "unknown") immediately and refresh in the background; the next
    # load has the answer. Explicit Test still probes synchronously — that is the one
    # place the user is waiting for the truth.
    if not block:
        with _STATE_LOCK:
            if not _REFRESHING:
                _REFRESHING = True
                threading.Thread(target=_connector_state, kwargs={"block": True},
                                 daemon=True).start()
        return cached if cached is not None else _unknown_state()

    cfg = get_mcp_cfg()
    servers = {s["name"]: s for s in get_mcp_servers()}

    ids = []
    for entry in CATALOG:
        cid = entry["id"]
        spec = servers.get(cid)
        configured = bool(spec) and (
            cid in ("rancher", "proxmox") or bool(cfg.get("servers"))
        )
        if spec and configured and spec.get("enabled") and spec.get("url"):
            ids.append(cid)

    probes: dict = {}
    threads = []
    for cid in ids:
        def mk(c=cid):
            probes[c] = _probe(servers.get(c) or {})
        t = threading.Thread(target=mk, daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join(7)

    state: dict = {}
    for entry in CATALOG:
        cid = entry["id"]
        spec = servers.get(cid)
        configured = bool(spec) and (
            cid in ("rancher", "proxmox") or bool(cfg.get("servers"))
        )
        pr = probes.get(cid) or {"reachable": False, "tools": 0, "exposed": 0}
        state[cid] = {
            "configured": configured,
            "enabled": bool(spec.get("enabled")) if spec else False,
            "reachable": pr["reachable"],
            "tools_available": pr["tools"],
            "tools_exposed": pr["exposed"],
        }
    with _STATE_LOCK:
        _STATE_CACHE = (now, state)
        _REFRESHING = False
    return state


@router.get("/mcp/servers")
def mcp_servers(user: str = Depends(get_current_user)) -> dict:
    """The connectors a CONVERSATION can be scoped to — the chat's scope picker.

    NOT `/connectors`: that one is the admin gallery, it lists connectors that are not
    enabled, and it requires admin. This is read by the chat header for admins and agents —
    the same two roles the infrastructure gate allows (see graph_rag._node_tools) — so it
    deliberately exposes no URLs, tokens or settings, only the names a user may choose
    between and whether each is actually usable right now.

    An end user gets an empty list rather than a 403: their chat never shows the picker, and
    a 403 would surface as an error banner in a UI that simply does not need the data.
    """
    from app.auth.rbac import get_role

    if get_role(user) not in ("admin", "agent"):
        return {"servers": [], "can_scope": False}
    try:
        from app.mcp.infra_agent import enabled_servers

        return {"servers": enabled_servers(), "can_scope": True}
    except Exception as exc:  # noqa: BLE001
        # A broken MCP config must not break the chat page it is decorating.
        logger.info("mcp/servers unavailable: %s: %s", type(exc).__name__, exc)
        return {"servers": [], "can_scope": False}


@router.get("/connectors")
def list_connectors(user: str = Depends(get_current_user)) -> dict:
    """The gallery: catalogue grouped by category, each entry with its real state."""
    _require_admin(user)
    from app.mcp.catalog import CATALOG, catalog_by_category
    from app.mcp.client import get_mcp_cfg, get_mcp_servers

    state = _connector_state()
    cfg = get_mcp_cfg()
    specs = {s["name"]: s for s in get_mcp_servers()}

    def public(entry: dict) -> dict:
        cid = entry["id"]
        st = state.get(cid, {})
        return {
            "id": cid,
            "name": entry["name"],
            "description": entry["description"],
            "category": entry["category"],
            "badge": entry.get("badge") or "",
            "source": entry["source"],
            "transport": entry.get("transport") or "streamable_http",
            "url_default": entry.get("url_default") or "",
            "fields": entry.get("fields") or [],
            "note": entry.get("note") or "",
            # Configured values, except secrets — same write-only contract as every
            # other integration. A secret is reported only as set/unset.
            "url": (specs.get(cid) or {}).get("url") or "",
            "rancher_url": str(cfg.get("rancher_url") or ""),
            "has_token": bool(
                (specs.get(cid) or {}).get("token")
                or cfg.get("rancher_token")
            ),
            "connected": bool(st.get("enabled") and st.get("configured")),
            "enabled": bool(st.get("enabled")),
            # None stays None: the UI distinguishes "not probed yet" from "not answering".
            "reachable": st.get("reachable"),
            "tools_available": st.get("tools_available", 0),
            "tools_exposed": st.get("tools_exposed", 0),
        }

    # Connectors the administrator added that are NOT in the catalogue still belong on
    # the screen — otherwise a working custom connector would be invisible.
    known = {e["id"] for e in CATALOG}
    extras = []
    for s in (cfg.get("servers") or []):
        if not isinstance(s, dict):
            continue
        sid = str(s.get("id") or "").strip()
        if not sid or sid in known:
            continue
        # Same bounded probe as the catalogue entries — never an inline list_tools call,
        # which is what made this endpoint take 20s.
        st = ({"reachable": None, "tools": 0, "exposed": 0} if not block
              else _probe({"name": sid, "url": s.get("url"), "enabled": s.get("enabled")}))
        extras.append({
            "id": sid,
            "name": str(s.get("name") or sid),
            "description": "Custom MCP connector added by an administrator.",
            "category": "Custom",
            "badge": "",
            "source": "custom",
            "transport": str(s.get("transport") or "streamable_http"),
            "url_default": "",
            "fields": [],
            "note": "",
            "url": str(s.get("url") or ""),
            "has_token": bool(s.get("token")),
            "connected": bool(s.get("enabled")),
            "enabled": bool(s.get("enabled")),
            "reachable": st.get("reachable"),
            "tools_available": st.get("tools", 0),
            "tools_exposed": st.get("exposed", 0),
        })

    groups = catalog_by_category()
    if extras:
        groups.append({"category": "Custom", "connectors": []})
    return {
        "groups": [
            {"category": g["category"], "connectors": [public(e) for e in g["connectors"]]}
            for g in groups
        ],
        "extras": extras,
        "counts": {
            "total": len(CATALOG) + len(extras),
            "connected": sum(1 for e in CATALOG if state.get(e["id"], {}).get("enabled")
                             and state.get(e["id"], {}).get("configured"))
                         + sum(1 for e in extras if e["connected"]),
            "reachable": sum(1 for e in CATALOG if state.get(e["id"], {}).get("reachable"))
                         + sum(1 for e in extras if e["reachable"]),
        },
    }


@router.post("/connectors/{connector_id}/test")
def test_connector(connector_id: str, payload: dict | None = None,
                   user: str = Depends(get_current_user)) -> dict:
    """Probe a connector (saving the posted values first so Test tests what you typed)."""
    _require_admin(user)
    if payload:
        connect_connector(connector_id, payload, user)
    from app.mcp.client import get_client
    from app.mcp.infra_agent import curated_for
    try:
        catalogue = {t.get("name"): t for t in get_client(connector_id).list_tools()}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "detail": f"{type(exc).__name__}: {str(exc)[:200]}"}
    exposed = curated_for(connector_id, catalogue)
    return {
        "ok": True,
        "tools_available": len(catalogue),
        "tools_exposed": len(exposed),
        "exposed": list(exposed)[:20],
        "detail": f"connected — {len(catalogue)} tool(s) available, {len(exposed)} "
                  f"read-only tool(s) exposed to the assistant",
    }


@router.post("/connectors/{connector_id}")
def connect_connector(connector_id: str, payload: dict,
                      user: str = Depends(get_current_user)) -> dict:
    """Connect or update a connector.

    The two shipped connectors keep their existing settings keys (they are special-cased
    in client.get_mcp_servers: Rancher has two auth modes, Proxmox reads its credential
    from a Kubernetes Secret). Everything else lands in `mcp.servers`.
    """
    _require_admin(user)
    p = payload or {}
    if connector_id == "rancher":
        update = {
            "enabled": p.get("enabled"),
            "url": p.get("url") or None,
            "rancher_url": p.get("rancher_url") or None,
            "rancher_token": p.get("rancher_token") or None,
        }
        r = put_integration_settings(
            "mcp", {"settings": {k: v for k, v in update.items() if v is not None}}, user)
        _invalidate_connector_cache()
        return r

    if connector_id == "proxmox":
        # Proxmox has no token field on purpose: its credential is a K8s Secret, not an
        # app setting. See get_mcp_servers().
        from app.mcp.client import save_mcp_server  # noqa: F401  (kept for symmetry)
        update = {k: v for k, v in {
            "proxmox_enabled": p.get("enabled"),
            "proxmox_url": p.get("url") or None,
        }.items() if v is not None}
        if not update:
            return {"ok": True, "status": 200, "detail": "nothing to update"}
        r = put_integration_settings("mcp", {"settings": update}, user)
        _invalidate_connector_cache()
        return r

    from app.mcp.catalog import catalog_entry
    from app.mcp.client import save_mcp_server

    entry = catalog_entry(connector_id) or {}
    display = p.get("name") or entry.get("name") or connector_id
    record = {
        "id": connector_id,
        "name": display,
        "url": p.get("url") or entry.get("url_default") or "",
        "transport": p.get("transport") or entry.get("transport") or "streamable_http",
        "enabled": str(p.get("enabled", "true")).strip().lower()
                   not in ("0", "false", "no", "off"),
    }
    if str(p.get("token") or "").strip():
        record["token"] = p["token"]
    if not record["url"]:
        raise HTTPException(status_code=400, detail="a connector URL is required")
    save_mcp_server(record)
    from app.mcp.client import reset_clients
    reset_clients()
    _invalidate_connector_cache()
    return {"ok": True, "status": 200,
            "detail": f"{display} connected — {record['url']} ({record['transport']})"}


@router.delete("/connectors/{connector_id}")
def disconnect_connector(connector_id: str, confirm: str = "",
                         user: str = Depends(get_current_user)) -> dict:
    """Disconnect. Destructive, so it needs ?confirm=<connector_id> (same guard style as
    the credential endpoints — the earlier production-config deletion proved that a bare
    DELETE is too easy to fire by accident)."""
    _require_admin(user)
    if confirm != connector_id:
        raise HTTPException(status_code=400,
                            detail=f"confirm={connector_id} required to disconnect")
    if connector_id in ("rancher", "proxmox"):
        key = "enabled" if connector_id == "rancher" else "proxmox_enabled"
        return put_integration_settings("mcp", {"settings": {key: "false"}}, user)
    from app.mcp.client import remove_mcp_server, reset_clients
    remove_mcp_server(connector_id)
    reset_clients()
    _invalidate_connector_cache()
    return {"ok": True, "status": 200, "detail": f"{connector_id} disconnected"}
