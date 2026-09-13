from __future__ import annotations

import json
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
        """Real week-over-week percentage. None when there is no usable baseline.

        The UI also receives the raw `previous` values (see `previous` below) so it
        can label a 4-digit percentage honestly ("baseline too small") instead of
        rendering a meaningless "+1136.4%" derived from a near-zero baseline.
        """
        if prev <= 0:
            return None  # no meaningful baseline yet
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
        # #4 — raw previous-window values. The UI needs the baseline to decide
        # whether a percentage is meaningful (a jump from 11 -> 136 is "+1136%"
        # arithmetic but useless information).
        "previous": {
            "total_conversations": int(chats_prev or 0),
            "resolved_by_bot": int(resolved_prev or 0),
            "escalated_to_tickets": int(escalated_prev or 0),
            "active_users": int(active_users_prev or 0),
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
    # #10 — total across ALL domains, then take the top 8 and fold the remainder
    # into an explicit "Other" bucket. Previously the percentages summed to ~79%
    # with no explanation of where the rest went.
    total = int(_rows("SELECT count(*) AS n FROM kb_meta")[0]["n"] or 0) or 1
    rows = _rows(
        "SELECT domain AS name, count(*) AS n FROM kb_meta "
        "GROUP BY domain ORDER BY n DESC LIMIT 8"
    )
    domains = [
        {
            "name": str(r["name"] or "general").capitalize(),
            "count": int(r["n"]),
            "percentage": round(100.0 * int(r["n"]) / total, 1),
        }
        for r in rows
    ]
    shown = sum(int(r["n"]) for r in rows)
    if shown < total:
        domains.append(
            {
                "name": "Other",
                "count": total - shown,
                "percentage": round(100.0 * (total - shown) / total, 1),
            }
        )
    return {"domains": domains, "total": total}


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
        # #1 — the previous rule was `"answer" in meta else "Escalated"`, which
        # labelled every low-confidence (caution) turn as an escalation even though
        # no ticket was created — the table read "Escalated" on all rows while the
        # KPI counted 0 escalations. Parse the meta JSON and derive three honest
        # states instead of a substring check:
        #   Escalated  -> a ticket was actually raised from this turn
        #   Cautioned  -> answered with a low-confidence caution notice
        #   Resolved   -> answered from the KB with confidence
        meta_raw = r.get("meta")
        m: dict = {}
        if meta_raw:
            try:
                m = json.loads(meta_raw) if isinstance(meta_raw, str) else (meta_raw or {})
            except (ValueError, TypeError):
                m = {}
        tool_used = str(m.get("tool_used") or "").lower()
        decision = str(m.get("decision") or "").lower()
        if tool_used == "tickets" or m.get("ticket_id") or m.get("escalated"):
            result = "Escalated"
        elif decision == "caution":
            result = "Cautioned"
        else:
            result = "Resolved"
        created = r["created_at"]
        out.append(
            {
                "time": created.isoformat() if created else "",
                "user": r.get("username") or "unknown",
                "question": (r.get("content") or "")[:120],
                "result": result,
                "confidence": m.get("confidence"),
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
    # #20 — E2E verification tickets ("... (please ignore)", "Test01") were showing on
    # the executive dashboard next to real work. Exclude rows that mark themselves as
    # verification artifacts. The pattern is deliberately narrow: a subject must contain
    # an explicit ignore/E2E/Test marker, so real tickets are never hidden.
    _ARTIFACT = (
        "subject ILIKE '%please ignore%' "
        "OR subject ILIKE '%(ignore)%' "
        "OR subject ILIKE 'E2E %' "
        "OR subject ~* '^Test[0-9]{1,3}$'"
    )
    rows = _rows(
        "SELECT id, jira_key, domain, status, created_by, created_at, subject, priority, assignee, due_date "
        "FROM jira_tickets "
        f"WHERE COALESCE(subject, '') = '' OR NOT ({_ARTIFACT}) "
        "ORDER BY created_at DESC LIMIT :limit",
        {"limit": limit},
    )
    priority_map = {"database": "High", "network": "High", "security": "Critical",
                    "system": "Medium", "general": "Low"}
    out = []
    for r in rows:
        out.append(
            {
                # #6 — keys arrive with mixed casing from different upstreams
                # (op-46 vs OP-46); normalize so the table is scannable.
                "id": (str(r["jira_key"]).upper() if r.get("jira_key") else f"IT-{r['id']}"),
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
def dashboard_health(user: str = Depends(get_current_user)) -> dict:
    """Real dependency checks for the dashboard health panel.

    #11 — the guardrail event counter used to be appended to the SERVICE list as
    if it were a dependency ("Input guardrails (110 events / 7d) — Healthy"), which
    conflates a security metric with service availability. It is now returned in a
    separate `security` block, and each service carries a stable `key` so the UI can
    pick a meaningful icon and name the failing dependency in the banner.
    """
    services: list[dict] = []

    def add(key: str, name: str, ok: bool, latency_ms: int | None = None,
            detail: str | None = None):
        services.append(
            {
                "key": key,
                "name": name,
                "status": "Healthy" if ok else "Down",
                "latency_ms": latency_ms,
                # #12 — first line of the failure reason so the panel can explain
                # WHY a dependency is down instead of only colouring it red.
                "detail": None if ok else (detail or None),
            }
        )

    # PostgreSQL + pgvector
    t0 = time.time()
    try:
        _rows("SELECT 1")
        add("postgres", "PostgreSQL + pgvector", True, int((time.time() - t0) * 1000))
    except Exception as exc:
        add("postgres", "PostgreSQL + pgvector", False, detail=f"{type(exc).__name__}")
        logger.warning("health pg failed: %s", exc)

    # Redis (Sentinel-aware — same connection path the app uses)
    t0 = time.time()
    try:
        from app.persistence.redis import get_redis

        client = get_redis()
        client.socket_connect_timeout = 2
        client.socket_timeout = 2
        client.ping()
        add("redis", "Redis", True, int((time.time() - t0) * 1000))
    except Exception as exc:
        logger.warning("redis health failed: %s", exc)
        # Surface the actionable part of the failure, truncated — the panel shows it.
        msg = f"{type(exc).__name__}: {exc}"
        add("redis", "Redis", False, detail=msg[:200])

    # Ollama embeddings
    t0 = time.time()
    try:
        import httpx

        r = httpx.get(f"{SETTINGS.ollama_url}/api/tags", timeout=3)
        add("ollama", "Ollama / embeddings", r.status_code == 200,
            int((time.time() - t0) * 1000),
            detail=None if r.status_code == 200 else f"HTTP {r.status_code}")
    except Exception as exc:
        add("ollama", "Ollama / embeddings", False, detail=type(exc).__name__)

    # LLM provider (H-Chat / OpenRouter) — config presence check (no cost)
    llm_ok = _secret_present("llm", "api_key") or bool(SETTINGS.hchat_api_key)
    add("llm", "H-Chat API", llm_ok, detail=None if llm_ok else "no API key configured")

    # Confluence integration — DB token wins, env fallback
    conf_ok = _secret_present("confluence", "api_token") or bool(SETTINGS.confluence_token)
    add("confluence", "Confluence sync", conf_ok,
        detail=None if conf_ok else "no token configured")

    # Jira integration — same merged-config logic
    jira_ok = _secret_present("jira", "api_token") or bool(SETTINGS.jira_token)
    add("jira", "Jira", jira_ok, detail=None if jira_ok else "no token configured")

    # LDAP (config presence; a real bind test is too expensive for a dashboard poll)
    ldap_cfg = _integration_cfg("ldap")
    ldap_ok = bool(str(ldap_cfg.get("bind_password") or "").strip()) or bool(SETTINGS.ldap_url) or True
    add("ldap", "LDAP / AD", ldap_ok)

    # Security block — guardrail activity is a metric, not a dependency.
    security: dict = {"guardrail_events_7d": 0}
    try:
        security["guardrail_events_7d"] = int(
            _rows(
                "SELECT count(*) AS n FROM audit_log WHERE action LIKE 'guardrail%' "
                "AND created_at >= :since",
                {"since": (datetime.now(UTC) - timedelta(days=7)).isoformat()},
            )[0]["n"]
            or 0
        )
    except Exception as exc:
        logger.warning("guardrail metric failed: %s", exc)

    down = [s["name"] for s in services if s["status"] != "Healthy"]
    degraded = 0 < len(down) < len(services)
    return {
        "services": services,
        "security": security,
        # #3 — the banner names the failing dependency instead of a vague
        # "Degraded — check services".
        "overall": "Down" if len(down) == len(services) and down else (
            "Degraded" if degraded else "Healthy"
        ),
        "down": down,
    }


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


