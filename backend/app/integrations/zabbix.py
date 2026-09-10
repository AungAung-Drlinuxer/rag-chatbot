"""Zabbix integration — monitoring NL query support (v1.1.9).

Config stored in system_settings key='zabbix' (Settings UI → Integrations):
  { base_url, api_token }

Provides:
- test_connection(): apiinfo.version check
- problems(): active problems → normalized for chat + UI
- hosts(): device/server availability from Zabbix
- Air-gapped friendly: pure HTTP JSON-RPC to the Zabbix server.
"""
from __future__ import annotations

import logging
import time

import httpx

from app.config import SETTINGS

logger = logging.getLogger("zabbix")

SEVERITY_NAMES = {
    0: "Not classified", 1: "Information", 2: "Warning",
    3: "Average", 4: "High", 5: "Disaster",
}


def _cfg() -> dict:
    """Merged config: system_settings row over env."""
    try:
        import json as _json
        from sqlalchemy import text as _t
        from app.persistence.database import SessionLocal
        with SessionLocal() as s:
            row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'zabbix'")).first()
        val = row[0] if row else {}
        if isinstance(val, str):
            try:
                val = _json.loads(val)
            except Exception:
                val = {}
        if isinstance(val, dict):
            return val
    except Exception:
        pass
    return {
        "base_url": getattr(SETTINGS, "zabbix_base_url", "") or "",
        "api_token": getattr(SETTINGS, "zabbix_api_token", "") or "",
    }


def is_configured() -> bool:
    c = _cfg()
    return bool((c.get("base_url") or "").strip() and (c.get("api_token") or "").strip())


class ZabbixClient:
    """Minimal Zabbix JSON-RPC 2.0 client (6.x, token auth)."""

    def __init__(self, base_url: str, api_token: str):
        self.url = base_url.rstrip("/") + "/api_jsonrpc.php"
        self.token = api_token
        self._id = 0

    def _call(self, method: str, params: dict | None = None):
        self._id += 1
        payload = {
            "jsonrpc": "2.0", "id": self._id, "method": method,
            "params": params or {},
        }
        if method != "apiinfo.version":
            payload["auth"] = self.token
        r = httpx.post(self.url, json=payload, timeout=8)
        r.raise_for_status()
        data = r.json()
        if "error" in data:
            raise RuntimeError(f"Zabbix API error: {data['error'].get('message')}")
        return data["result"]

    def version(self) -> str:
        return self._call("apiinfo.version")

    def problems(self, limit: int = 50) -> list[dict]:
        """Active problems: name, severity, age."""
        rows = self._call("problem.get", {
            "output": ["name", "severity", "clock"],
            "recent": False,
            "sortfield": "eventid", "sortorder": "DESC",
            "limit": 100,
        }) or []
        out = []
        for p in rows:
            out.append({
                "name": p.get("name", ""),
                "severity": int(p.get("severity", 0)),
                "clock": int(p.get("clock", 0)),
            })
        return out

    def hosts(self) -> list[dict]:
        """Monitored hosts with interface availability (up/down/unknown) + IP."""
        hosts = self._call("host.get", {
            "output": ["hostid", "host", "name", "status"],
            "selectInterfaces": ["ip", "available"],
            "filter": {"status": 0},
            "limit": 500,
        }) or []
        out = []
        for h in hosts:
            interfaces = h.get("interfaces") or []
            ip, available = "", "unknown"
            if interfaces:
                i0 = interfaces[0]
                ip = i0.get("ip", "")
                available = {"0": "unknown", "1": "up", "2": "down"}.get(
                    str(i0.get("available", "0")), "unknown")
            out.append({
                "host": h.get("host"), "hostid": h.get("hostid"),
                "ip": ip, "available": available,
            })
        return out


def client() -> ZabbixClient:
    c = _cfg()
    return ZabbixClient(c["base_url"], c["api_token"])


def test_connection() -> dict:
    """Settings → Test connection handler."""
    c = _cfg()
    if not c.get("base_url") or not c.get("api_token"):
        return {"ok": False, "detail": "base_url and api_token required"}
    try:
        version = client().version()
        return {"ok": True, "detail": f"Zabbix {version} reachable"}
    except Exception as exc:
        return {"ok": False, "detail": f"{type(exc).__name__}: {exc}"}


def summarize_problems(problems: list[dict]) -> str:
    """Human summary for the chat pipeline (NL query support)."""
    if not problems:
        return "No active problems — all monitored devices and servers are healthy."
    lines = []
    now = int(time.time())
    for p in problems[:15]:
        sev = SEVERITY_NAMES.get(int(p.get("severity", 0)), "Unknown")
        age_min = max(0, now - int(p.get("clock", 0))) // 60
        age = f"{age_min // 60}h{age_min % 60}m ago" if age_min >= 60 else f"{age_min}m ago"
        lines.append(f"- [{sev}] {p['name']} ({age})")
    if len(problems) > 15:
        lines.append(f"... and {len(problems) - 15} more")
    return "\n".join(lines)
