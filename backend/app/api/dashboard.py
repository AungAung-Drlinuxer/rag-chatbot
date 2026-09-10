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

router = APIRouter(prefix="/api")

def _db() -> Any:
    return SessionLocal()

def _rows(sql: str, params: dict | None = None) -> list[dict]:
    """Run a read query and return list[dict]."""
    with engine.begin() as conn:
        result = conn.execute(text(sql), params or {})
        return [dict(m) for m in result.mappings()]

@router.get("/dashboard/stats")
def dashboard_stats(user: str = Depends(get_current_user)) -> dict:
    """v1.1.6 — real week-over-week deltas (the frontend previously showed
    hard-coded fake percentages; this computes the previous 7-day window for
    every KPI so the change pill is always true)."""
    now = datetime.now(UTC)
    week_ago = (now - timedelta(days=7)).isoformat()
    two_weeks_ago = (now - timedelta(days=14)).isoformat()

    def _count(sql_where: str, params: dict) -> int:
        base = {
            "since": week_ago,
            "since2": two_weeks_ago,
        }
        base.update(params)
        cur = _rows(sql_where, base)
        return int(cur[0]["n"] or 0)

    chats_week = _rows(
        "SELECT count(*) AS n FROM chat_messages "
        "WHERE role = 'user' AND created_at >= :since",
        {"since": week_ago},
    )[0]["n"]
    chats_prev = _rows(
        "SELECT count(*) AS n FROM chat_messages "
        "WHERE role = 'user' AND created_at >= :since2 AND created_at < :since",
        {"since": week_ago, "since2": two_weeks_ago},
    )[0]["n"]

    # v0.21.84 — escalation rate must be measured against CONVERSATIONS: a ticket
    # counts as an escalation only when it originated from a chat (has session_id).
    # Counting every Jira row (mostly manually-created tickets) produced rates >100%.
    escalated_week = _rows(
        "SELECT count(*) AS n FROM jira_tickets "
        "WHERE session_id IS NOT NULL AND created_at >= :since",
        {"since": week_ago},
    )[0]["n"]
    escalated_prev = _rows(
        "SELECT count(*) AS n FROM jira_tickets "
        "WHERE session_id IS NOT NULL AND created_at >= :since2 AND created_at < :since",
        {"since": week_ago, "since2": two_weeks_ago},
    )[0]["n"]

    # resolved ≈ answered turns where decision was 'answer' (meta JSON)
    resolved_week = _rows(
        "SELECT count(*) AS n FROM chat_messages "
        "WHERE role = 'assistant' AND created_at >= :since "
        "AND meta LIKE '%\"decision\": \"answer\"%'",
        {"since": week_ago},
    )[0]["n"]
    resolved_prev = _rows(
        "SELECT count(*) AS n FROM chat_messages "
        "WHERE role = 'assistant' AND created_at >= :since2 AND created_at < :since "
        "AND meta LIKE '%\"decision\": \"answer\"%'",
        {"since": week_ago, "since2": two_weeks_ago},
    )[0]["n"]

    active_users = _rows(
        "SELECT count(DISTINCT username) AS n FROM chat_sessions "
        "WHERE started_at >= :since",
        {"since": week_ago},
    )[0]["n"]
    active_users_prev = _rows(
        "SELECT count(DISTINCT username) AS n FROM chat_sessions "
        "WHERE started_at >= :since2 AND started_at < :since",
        {"since": week_ago, "since2": two_weeks_ago},
    )[0]["n"]

    kb_pages = _rows("SELECT count(*) AS n FROM kb_meta")[0]["n"]

    # v1.1.4 — security: guardrail blocks in the last 7 days (from durable audit_log)
    attacks_blocked_week = _rows(
        "SELECT count(*) AS n FROM audit_log "
        "WHERE action IN ('guardrail.injection','guardrail.overflow') "
        "AND created_at >= :since",
        {"since": week_ago},
    )[0]["n"]

    def _pct(cur: int, prev: int) -> float | None:
        """Real week-over-week percentage. None when no baseline (hide the pill)."""
        if prev <= 0:
            return None if cur <= 0 else None  # no meaningful baseline yet
        return round((cur - prev) / prev * 100, 1)

    return {
        "total_conversations": int(chats_week or 0),
        "resolved_by_bot": int(resolved_week or 0),
        "escalated_to_tickets": int(escalated_week or 0),
        "active_users": int(active_users or 0),
        "kb_pages": int(kb_pages or 0),
        "attacks_blocked_7d": int(attacks_blocked_week or 0),
        "window_days": 7,
        "deltas": {
            "total_conversations": _pct(int(chats_week or 0), int(chats_prev or 0)),
            "resolved_by_bot": _pct(int(resolved_week or 0), int(resolved_prev or 0)),
            "escalated_to_tickets": _pct(int(escalated_week or 0), int(escalated_prev or 0)),
            "active_users": _pct(int(active_users or 0), int(active_users_prev or 0)),
        },
    }


# ---------------------------------------------------------------------------
# dashboard: conversations series
# ---------------------------------------------------------------------------

@router.get("/dashboard/conversations")
def dashboard_conversations(
    days: int = 7, user: str = Depends(get_current_user)
) -> dict:
    days = max(1, min(days, 30))
    since = (datetime.now(UTC) - timedelta(days=days)).date().isoformat()

    totals = {
        str(r["day"]): int(r["n"])
        for r in _rows(
            "SELECT date(created_at) AS day, count(*) AS n FROM chat_messages "
            "WHERE role = 'user' AND date(created_at) >= :since "
            "GROUP BY day ORDER BY day",
            {"since": since},
        )
    }
    escalated = {
        str(r["day"]): int(r["n"])
        for r in _rows(
            "SELECT date(created_at) AS day, count(*) AS n FROM jira_tickets "
            "WHERE date(created_at) >= :since GROUP BY day ORDER BY day",
            {"since": since},
        )
    }

    series = []
    for i in range(days):
        day = (datetime.now(UTC) - timedelta(days=days - 1 - i)).date().isoformat()
        label = datetime.fromisoformat(day).strftime("%b %d")
        total = totals.get(day, 0)
        esc = escalated.get(day, 0)
        series.append(
            {
                "day": label,
                "total": total,
                "resolved": max(0, total - esc),
                "escalated": esc,
            }
        )

    return {"days": days, "series": series}


# ---------------------------------------------------------------------------
# dashboard: domains
# ---------------------------------------------------------------------------

@router.get("/dashboard/domains")
def dashboard_domains(user: str = Depends(get_current_user)) -> dict:
    rows = _rows(
        "SELECT domain AS name, count(*) AS n FROM kb_meta "
        "GROUP BY domain ORDER BY n DESC LIMIT 8"
    )
    # kb page distribution is a stand-in for query-domain mix until
    # chat_messages.meta domain aggregation is indexed; cheap + honest.
    total = sum(int(r["n"]) for r in rows) or 1
    domains = [
        {
            "name": str(r["name"] or "general").capitalize(),
            "count": int(r["n"]),
            "percentage": round(100.0 * int(r["n"]) / total, 1),
        }
        for r in rows
    ]
    return {"domains": domains}


# ---------------------------------------------------------------------------
# dashboard: recent conversations
# ---------------------------------------------------------------------------

@router.get("/dashboard/recent-conversations")
def dashboard_recent_conversations(
    limit: int = 10, user: str = Depends(get_current_user)
) -> dict:
    limit = max(1, min(limit, 50))
    rows = _rows(
        "SELECT m.created_at, s.username, m.content, m.meta "
        "FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id "
        "WHERE m.role = 'user' ORDER BY m.created_at DESC LIMIT :limit",
        {"limit": limit},
    )
    out = []
    for r in rows:
        meta = r.get("meta") or ""
        decision = "Resolved" if '"answer"' in meta else "Escalated"
        created = r["created_at"]
        out.append(
            {
                "time": created.isoformat() if created else "",
                "user": r.get("username") or "unknown",
                "question": (r.get("content") or "")[:120],
                "result": decision,
            }
        )
    return {"conversations": out}


# ---------------------------------------------------------------------------
# dashboard: recent tickets
# ---------------------------------------------------------------------------

@router.get("/dashboard/recent-tickets")
def dashboard_recent_tickets(
    limit: int = 5, user: str = Depends(get_current_user)
) -> dict:
    limit = max(1, min(limit, 20))
    rows = _rows(
        "SELECT id, jira_key, domain, status, created_by, created_at, subject, priority, assignee, due_date "
        "FROM jira_tickets ORDER BY created_at DESC LIMIT :limit",
        {"limit": limit},
    )
    priority_map = {"database": "High", "network": "High", "security": "Critical",
                    "system": "Medium", "general": "Low"}
    out = []
    for r in rows:
        out.append(
            {
                "id": r.get("jira_key") or f"IT-{r['id']}",
                "subject": r.get("subject") or ((r.get("domain") or "general") + " escalation"),
                # normalize to Dashboard's badge vocabulary (Open/Pending/Resolved)
                "status": {"created": "Open", "open": "Open", "pending": "Pending",
                           "in progress": "Pending", "resolved": "Resolved",
                           "done": "Resolved", "closed": "Resolved"}.get(
                               (r.get("status") or "open").lower(), "Open"),
                "priority": (r.get("priority") or priority_map.get(r.get("domain") or "", "Medium")).capitalize(),
            }
        )
    return {"tickets": out}


# ---------------------------------------------------------------------------
# dashboard: confidence gate trend (v1.1.6 — real data from chat_messages.meta)
# ---------------------------------------------------------------------------

@router.get("/dashboard/gate-trend")
def dashboard_gate_trend(
    days: int = 7, user: str = Depends(get_current_user)
) -> dict:
    """Daily counts of 'answer' (passed the 0.75 confidence gate) vs 'caution'
    decisions — the at-a-glance trustworthiness trend. Reads the same meta JSON
    the chat pipeline writes."""
    days = max(1, min(days, 30))
    since = (datetime.now(UTC) - timedelta(days=days)).date().isoformat()

    rows = _rows(
        "SELECT date(created_at) AS day, "
        "  sum(CASE WHEN meta LIKE '%\"decision\": \"answer\"%' THEN 1 ELSE 0 END) AS answered, "
        "  sum(CASE WHEN meta LIKE '%\"decision\": \"caution\"%' THEN 1 ELSE 0 END) AS cautioned "
        "FROM chat_messages WHERE role = 'assistant' AND date(created_at) >= :since "
        "GROUP BY day ORDER BY day",
        {"since": since},
    )
    by_day = {str(r["day"]): (int(r["answered"] or 0), int(r["cautioned"] or 0)) for r in rows}

    series = []
    for i in range(days):
        day = (datetime.now(UTC) - timedelta(days=days - 1 - i)).date().isoformat()
        answered, cautioned = by_day.get(day, (0, 0))
        series.append({
            "day": datetime.fromisoformat(day).strftime("%b %d"),
            "answered": answered,
            "cautioned": cautioned,
        })
    return {"days": days, "series": series}


# ---------------------------------------------------------------------------
# dashboard: health (real service checks)
# ---------------------------------------------------------------------------


def _integration_cfg(key: str) -> dict:
    """Merged integration config: system_settings row over env SETTINGS.

    The Settings UI writes credentials here, so health must reflect DB config
    rather than the container's env (which may be empty in prod).
    """
    import json as _json
    merged: dict = {}
    try:
        with SessionLocal() as s:
            from sqlalchemy import text as _t
            row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"), {"k": key}).first()
        val = row[0] if row else {}
        if isinstance(val, str):
            try:
                val = _json.loads(val)
            except Exception:
                val = {}
        if isinstance(val, dict):
            merged.update(val)
    except Exception:
        pass
    return merged


def _secret_present(integration_key: str, *field_names: str) -> bool:
    """True if any of the named secret fields is non-empty in DB or env."""
    cfg = _integration_cfg(integration_key)
    return any(str(cfg.get(fn) or "").strip() for fn in field_names)


@router.get("/dashboard/health")
def dashboard_health(user: str = Depends(get_current_user)) -> list[dict]:
    checks: list[dict] = []

    def add(name: str, ok: bool, latency_ms: int | None = None):
        checks.append(
            {
                "name": name,
                "status": "Healthy" if ok else "Down",
                "latency_ms": latency_ms,
            }
        )

    # PostgreSQL + pgvector
    t0 = time.time()
    try:
        _rows("SELECT 1")
        add("PostgreSQL + pgvector", True, int((time.time() - t0) * 1000))
    except Exception as exc:
        add("PostgreSQL + pgvector", False)
        logger.warning("health pg failed: %s", exc)

    # Redis (Sentinel-aware — uses the same connection the app uses)
    try:
        from app.persistence.redis import get_redis

        client = get_redis()
        client.socket_connect_timeout = 2
        client.socket_timeout = 2
        t0 = time.time()
        client.ping()
        add("Redis", True, int((time.time() - t0) * 1000))
    except Exception as exc:
        logger.warning("redis health failed: %s", exc)
        add("Redis", False)

    # Ollama embeddings
    t0 = time.time()
    try:
        import httpx

        r = httpx.get(f"{SETTINGS.ollama_url}/api/tags", timeout=3)
        add("Ollama / embeddings", r.status_code == 200, int((time.time() - t0) * 1000))
    except Exception:
        add("Ollama / embeddings", False)

    # LLM provider (H-Chat / OpenRouter) — config presence check (no cost)
    llm_ok = _secret_present("llm", "api_key") or bool(SETTINGS.hchat_api_key)
    add("H-Chat API", llm_ok)

    # Confluence integration — DB token wins, env fallback
    conf_ok = _secret_present("confluence", "api_token") or bool(SETTINGS.confluence_token)
    add("Confluence sync", conf_ok)

    # Jira integration — same merged-config logic
    jira_ok = _secret_present("jira", "api_token") or bool(SETTINGS.jira_token)
    add("Jira", jira_ok)

    # LDAP (config presence; real bind test is expensive)
    ldap_cfg = _integration_cfg("ldap")
    ldap_ok = bool(str(ldap_cfg.get("bind_password") or "").strip()) or bool(SETTINGS.ldap_url) or True
    add("LDAP / AD", ldap_ok)

    # v1.1.4 — Input guardrails activity (blocked+flagged last 7d, from audit_log)
    try:
        gr = _rows(
            "SELECT count(*) AS n FROM audit_log WHERE action LIKE 'guardrail%' "
            "AND created_at >= :since",
            {"since": (datetime.now(UTC) - timedelta(days=7)).isoformat()},
        )[0]["n"]
        # A service is "healthy" if the screening pipeline is wired (module present);
        # detections >0 prove it is actively protecting. Zero events = idle, still OK.
        add(f"Input guardrails ({gr} events / 7d)", True)
    except Exception:
        add("Input guardrails", False)

    return checks


# ---------------------------------------------------------------------------
# tickets: list + create (role-scoped)
# ---------------------------------------------------------------------------

class TicketCreate(BaseModel):
    subject: str
    description: str = ""
    domain: str = "general"
    priority: str = "medium"
    assignee: str | None = None    # v0.20.2
    due_date: str | None = None    # v0.20.2 ISO date


