from __future__ import annotations

import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

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
    # never return the password to the client
    safe = {k: v for k, v in (val or {}).items() if k != "password"}
    safe["password_set"] = bool(val and val.get("password"))
    return {"smtp": safe}

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
INTEGRATION_KEYS = {"confluence", "jira", "ldap", "keycloak", "llm", "redis", "ollama", "openproject", "xwiki"}

@router.get("/settings/integrations/{key}")
def get_integration_settings(key: str, user: str = Depends(get_current_user)) -> dict:
    if key not in INTEGRATION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown integration")
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"), {"k": key}).first()
    import json as _json
    val = row[0] if row else {}
    if isinstance(val, str):
        try: val = _json.loads(val)
        except Exception: val = {}
    safe = {k: v for k, v in (val or {}).items() if not (k.endswith("_token") or k.endswith("_password"))}
    safe["token_set"] = bool(val and val.get("api_token"))
    return {"integration": key, "settings": safe}

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
        current = current or {}
        for k, v in data.items():
            if (k.endswith("_token") or k.endswith("_password") or k in ("api_key", "password")) and not v:
                continue  # empty secret keeps the stored one
            current[k] = v
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES (:k, :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"k": key, "v": _json.dumps(current)})
        s.commit()
    if key == "llm":
        from app.llm.client import reload_llm_cfg
        reload_llm_cfg()
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
        else:
            raise ValueError(f"no test for {key}")
        if status in (200, 201):
            return {"ok": True, "status": status}
        return {"ok": False, "status": status, "detail": detail}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)[:200]}


@router.get("/settings/integrations/llm/models")
def list_llm_models(user: str = Depends(get_current_user)) -> dict:
    """Fetch the model catalogue from the configured provider (saved key required).

    Returns [{id, name}] sorted by id. Used by the Settings -> Integrations ->
    H-Chat (LLM API) model selector so admins pick from the provider's real list.
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

