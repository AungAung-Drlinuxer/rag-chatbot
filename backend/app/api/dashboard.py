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
    since = datetime.now(UTC) - timedelta(days=7)
    week_ago = since.isoformat()

    chats_week = _rows(
        "SELECT count(*) AS n FROM chat_messages "
        "WHERE role = 'user' AND created_at >= :since",
        {"since": week_ago},
    )[0]["n"]

    # v0.21.84 — escalation rate must be measured against CONVERSATIONS: a ticket
    # counts as an escalation only when it originated from a chat (has session_id).
    # Counting every Jira row (mostly manually-created tickets) produced rates >100%.
    escalated_week = _rows(
        "SELECT count(*) AS n FROM jira_tickets "
        "WHERE session_id IS NOT NULL AND created_at >= :since",
        {"since": week_ago},
    )[0]["n"]

    # resolved ≈ answered turns where decision was 'answer' (meta JSON)
    resolved_week = _rows(
        "SELECT count(*) AS n FROM chat_messages "
        "WHERE role = 'assistant' AND created_at >= :since "
        "AND meta LIKE '%\"decision\": \"answer\"%'",
        {"since": week_ago},
    )[0]["n"]

    active_users = _rows(
        "SELECT count(DISTINCT username) AS n FROM chat_sessions "
        "WHERE started_at >= :since",
        {"since": week_ago},
    )[0]["n"]

    kb_pages = _rows("SELECT count(*) AS n FROM kb_meta")[0]["n"]

    return {
        "total_conversations": int(chats_week or 0),
        "resolved_by_bot": int(resolved_week or 0),
        "escalated_to_tickets": int(escalated_week or 0),
        "active_users": int(active_users or 0),
        "kb_pages": int(kb_pages or 0),
        "window_days": 7,
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
# dashboard: health (real service checks)
# ---------------------------------------------------------------------------

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
    add("H-Chat API", bool(SETTINGS.hchat_api_key))

    # Confluence integration
    add("Confluence sync", bool(SETTINGS.confluence_token))

    # LDAP (config presence; real bind test is expensive)
    add("LDAP / AD", bool(SETTINGS.ldap_enabled) if hasattr(SETTINGS, "ldap_enabled") else True)

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


