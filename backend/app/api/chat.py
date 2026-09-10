from __future__ import annotations

from app.schemas import ChatRequest, EscalateRequest, FeedbackRequest

import json
import os
import time
import uuid
from contextlib import contextmanager

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.auth.deps import get_current_user
from app.api.auth import _require_chatbot
from app.auth.rbac import get_role, require_role, allowed_domains
from app.config import SETTINGS
from app.observability.audit import audit
from app.observability.telemetry import start_span
from app.security.rate_limit import limit
from app.persistence.models import ChatMessage, ChatSession, Feedback
from app.persistence.database import SessionLocal
from app.orchestration.orchestrator import run_rag
from app.rag.gate import DECISION_CAUTION, caution_message
from app.integrations.contacts import get_contact
from app.integrations.jira import escalate as jira_escalate
from app.llm.client import stream_answer
import logging
logger = logging.getLogger("chat")

router = APIRouter()

def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _chunk_text(text: str, size: int = 40):
    """Yield answer text in small chunks (SSE token streaming feel)."""
    for i in range(0, len(text), size):
        yield text[i:i + size]


def _monitoring_answer(kind: str, message: str) -> tuple[str, list[dict]]:
    """v1.1.9 — resolve a monitoring NL query against Zabbix and/or the LGTM stack.

    Returns (answer_markdown, hits_for_ui). Failures degrade to a helpful note.
    """
    parts: list[str] = []
    hits: list[dict] = []

    # --- Zabbix side (devices/servers) -------------------------------------
    if kind in ("zabbix", "hosts", "status", "problems"):
        try:
            from app.integrations import zabbix as zb
            if zb.is_configured():
                problems = zb.client().problems()
                summary = zb.summarize_problems(problems)
                parts.append("**Zabbix — active problems**\n" + summary)
                hits.append({"page_id": "zabbix-problems", "title": "Zabbix active problems",
                             "source": "Zabbix", "relevance": 100,
                             "excerpt": summary[:180], "source_url": None})
                if kind in ("hosts", "status"):
                    hosts = zb.client().hosts()
                    downs = [h for h in hosts if h["available"] == "down"]
                    ups = [h for h in hosts if h["available"] == "up"]
                    parts.append(f"\n**Hosts** — {len(ups)} up, {len(downs)} down, "
                                 f"{len(hosts) - len(ups) - len(downs)} unknown")
                    for h in downs[:10]:
                        parts.append(f"- 🔴 {h['host']} ({h['ip']}) — unreachable")
                    for h in ups[:10]:
                        parts.append(f"- 🟢 {h['host']} ({h['ip']})")
            else:
                parts.append("Zabbix is not configured yet. An administrator can connect it in "
                             "Settings → Integrations → Zabbix (base URL + API token).")
        except Exception as exc:
            logger.warning("zabbix query failed: %s", exc)
            parts.append(f"Zabbix query failed: {type(exc).__name__}: {exc}")

    # --- IT inventory --------------------------------------------------------
    if kind == "inventory":
        try:
            from sqlalchemy import text as _t
            from app.persistence.database import SessionLocal as _SL
            # extract search keyword from the question (last noun-ish token)
            import re as _re2
            m = _re2.search(r'(?:for|of|about|assigned to|hosting|on)\s+([a-zA-Z0-9._-]{2,40})', message.lower())
            kw = m.group(1) if m else ""
            with _SL() as s:
                if kw:
                    rows = s.execute(_t(
                        "SELECT name, category, hostname, ip_address, location, assigned_to "
                        "FROM inventory_items WHERE name ILIKE :kw OR hostname ILIKE :kw "
                        "OR ip_address ILIKE :kw OR assigned_to ILIKE :kw OR location ILIKE :kw LIMIT 20"
                    ), {"kw": f"%{kw}%"}).fetchall()
                else:
                    rows = s.execute(_t(
                        "SELECT name, category, hostname, ip_address, location, assigned_to "
                        "FROM inventory_items ORDER BY name LIMIT 20")).fetchall()
            if rows:
                parts.append(f"\n**IT Inventory** — {len(rows)} matching items")
                for r in rows:
                    parts.append(
                        f"- 🖥 **{r[0]}** ({r[1]}) — host: {r[2] or '-'} · IP: {r[3] or '-'} · "
                        f"location: {r[4] or '-'} · assigned: {r[5] or '-'}")
                hits.append({"page_id": "inventory", "title": "IT inventory lookup",
                             "source": "Inventory", "relevance": 100,
                             "excerpt": f"{len(rows)} items", "source_url": None})
            else:
                suffix = f" for '{kw}'" if kw else ""
                parts.append(f"\nNo inventory items found{suffix}.")
        except Exception as exc:
            logger.warning("inventory query failed: %s", exc)
            parts.append(f"Inventory query failed: {type(exc).__name__}: {exc}")

    # --- Kubernetes / LGTM side --------------------------------------------
    if kind in ("cluster", "app", "status"):
        try:
            from app.integrations.lgmt import cluster_health_summary, summarize_cluster_health
            h = cluster_health_summary()
            parts.append("\n**Kubernetes cluster & app status**\n" + summarize_cluster_health(h))
            hits.append({"page_id": "k8s-cluster", "title": "K8s cluster status",
                         "source": "LGTM", "relevance": 100,
                         "excerpt": summarize_cluster_health(h)[:180], "source_url": None})
        except Exception as exc:
            logger.warning("lgmt query failed: %s", exc)
            parts.append(f"Cluster status query failed: {type(exc).__name__}: {exc}")

    # --- Grafana dashboards-as-knowledge (v1.2.6) ---------------------------
    # Pulls the administrator-created dashboards via service-account token and
    # executes their panel PromQL — multi-cluster coverage without hardcoding.
    if kind == "grafana":
        try:
            import re as _re
            from app.integrations import grafana as gf
            if not gf.is_configured():
                parts.append("\nGrafana integration not configured — add a service-account token in Settings → Integrations → Grafana.")
            else:
                q = message.lower()
                dbs = gf.list_dashboards()

                # If the user asks about dashboard count or listing dashboards
                is_list_or_count = bool(_re.search(r"(how many|list|what|which|show|all).*dashboard|dashboards?", q)) and not any(
                    k in q for k in ["metric", "value", "stat", "cpu", "memory", "panel", "data"]
                )

                if is_list_or_count:
                    parts.append(f"**Grafana Dashboards ({len(dbs)} available)**\n")
                    for d in dbs:
                        title = d.get("title", "Untitled")
                        uid = d.get("uid", "")
                        url = f"{gf._cfg('base_url')}/d/{uid}" if uid else None
                        parts.append(f"- 📊 [{title}]({url})" if url else f"- 📊 {title}")
                        hits.append({
                            "page_id": f"grafana-{uid}",
                            "title": title,
                            "source": "Grafana",
                            "relevance": 100,
                            "excerpt": f"Dashboard UID: {uid}",
                            "source_url": url,
                        })
                else:
                    # v1.3.2 — PANEL-LEVEL scoring: score every panel title across ALL
                    # dashboards against the question, render the top matches first.
                    # This gives precise pin-point answers ("latency", "tokens", "cost",
                    # "guardrail", "restarts"…) instead of dumping the first 3 panels.
                    generic_words = {"dashboard", "dashboards", "grafana", "data", "view",
                                     "views", "show", "get", "what", "which", "how", "the"}
                    scored: list[tuple[int, dict, dict]] = []  # (score, dashboard, panel)
                    for d in dbs:
                        dash = gf.get_dashboard(d["uid"])
                        if not dash:
                            continue
                        for panel in gf.flatten_panels(dash):
                            if "$" in panel.get("expr", ""):
                                continue  # template-variable panels need user context
                            pt = (panel.get("title") or "").lower()
                            if not pt:
                                continue
                            score = 0
                            for w in _re.split(r"\W+", pt):
                                if len(w) > 2 and w in q:
                                    score += 2
                            # bonus for high-signal words appearing in the question
                            for w in _re.split(r"\W+", q):
                                if len(w) > 2 and w in pt:
                                    score += 1
                            if score > 0:
                                scored.append((score, d, panel))
                    scored.sort(key=lambda x: -x[0])

                    if scored:
                        parts.append(f"\n**Grafana — {len(scored)} matching panels (top 4):**")
                        for score, d, panel in scored[:4]:
                            try:
                                res = gf.run_prom_query(panel["expr"])
                                parts.append(
                                    f"\n*{panel['title']}*  _(from: {d.get('title')})_\n"
                                    + gf.render_prom_results(res, panel.get("legend", "")))
                                hits.append({"page_id": f"grafana-{d['uid']}",
                                             "title": panel["title"], "source": "Grafana",
                                             "relevance": min(100, 60 + score * 5),
                                             "excerpt": f"{len(res)} series",
                                             "source_url": gf._cfg("base_url") + "/d/" + d["uid"]})
                            except Exception as perr:
                                logger.debug("panel %s failed: %s", panel.get("title"), perr)
                    else:
                        # No keyword match → fall back to the primary RAG dashboard overview
                        rag_dbs = [d for d in dbs
                                   if (d.get("title") or "").lower().startswith("rag chatbot")]
                        target = rag_dbs[0] if rag_dbs else (dbs[0] if dbs else None)
                        if target:
                            dash = gf.get_dashboard(target["uid"])
                            panels = gf.flatten_panels(dash) if dash else []
                            parts.append(f"\n**Grafana: {target.get('title')}**")
                            rendered = 0
                            for panel in panels:
                                if rendered >= 3:
                                    break
                                if "$" in panel.get("expr", ""):
                                    continue
                                try:
                                    res = gf.run_prom_query(panel["expr"])
                                    if res:
                                        parts.append(f"\n*{panel['title']}*\n" + gf.render_prom_results(res, panel.get("legend", "")))
                                        rendered += 1
                                except Exception:
                                    pass
                        else:
                            parts.append("\n_No dashboards visible with the configured token._")
        except Exception as exc:
            logger.warning("grafana query failed: %s", exc)
            parts.append(f"Grafana query failed: {type(exc).__name__}: {exc}")

    if not parts:
        parts.append("No monitoring data available for this question.")
    return "\n\n".join(parts), hits


@router.post("/api/chat/stream")
@limit("chat")
def chat_stream(req: ChatRequest, user: str = Depends(_require_chatbot)) -> StreamingResponse:
    """Design doc §3 single pipeline, streamed over SSE.

    Events: meta (domain/confidence/decision/hits) → token* → done.
    """
    raw_sid = req.session_id or str(uuid.uuid4())
    try:
        session_id = str(uuid.UUID(raw_sid))
    except (ValueError, AttributeError):
        session_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, raw_sid))

    def gen():
        t0 = time.time()

        # v1.1.4 — INPUT GUARDRAILS (prompt injection / overflow / toxicity).
        # Deterministic screening BEFORE any LLM cost or DB write.
        guardrail_flag = None
        try:
            from app.security.guardrails import check_input
            verdict = check_input(req.message)
            if verdict.action in ("blocked", "flagged"):
                from app.observability.metrics import GUARDRAIL_EVENTS_TOTAL
                GUARDRAIL_EVENTS_TOTAL.labels(type=verdict.type, action=verdict.action).inc()
                logger.warning("GUARDRAIL %s (%s) user=%s: %s",
                               verdict.action, verdict.type, user, verdict.reason)
                try:
                    audit("guardrail." + verdict.type, user, detail=verdict.reason[:120])
                except Exception:
                    pass
                if verdict.action == "blocked":
                    yield _sse("caution", {
                        "message": ("Your message was blocked by content security policy ("
                                    f"{verdict.type}). Please rephrase your question."),
                        "blocked": True, "type": verdict.type})
                    yield _sse("done", {"message_id": "", "latency_ms": 0,
                                        "guardrail": verdict.type})
                    return
                # v1.2.3 — flagged (toxic): reply immediately with a polite refusal.
                # The old path burned a full LLM call (107s on CPU fallback) just to
                # say "I can't help with that." Deterministic, instant, zero cost.
                _refusal = ("I can't help with that. If you have an IT question — "
                            "passwords, VPN, tickets, hardware — I'm happy to assist.")
                yield _sse("caution", {"message": _refusal, "flagged": True, "type": verdict.type})
                yield _sse("token", {"token": _refusal})
                yield _sse("done", {"message_id": "", "latency_ms": int((time.time() - t0) * 1000),
                                    "guardrail": verdict.type})
                return
        except Exception as guardrail_err:
            # Never break the chat on guardrail machinery failure
            logger.warning("guardrail check failed (%s) — allowing request", guardrail_err)

        # Persist the user turn (best-effort; must not break the stream).
        try:
            from app.persistence.database import SessionLocal
            s = SessionLocal()
            sess = s.get(ChatSession, session_id)
            if sess is None:
                sess = ChatSession(id=session_id, username=user)
                s.add(sess)
                s.flush()  # ensure session row exists before the FK'd message insert
            s.add(ChatMessage(session_id=session_id, role="user", content=req.message))
            s.commit()
        except Exception as exc:
            logger.warning(f"persist user turn skipped ({type(exc).__name__}): {exc}")
            s = None

        # Stage feedback (v0.16.4): tell the client what the pipeline is doing so the
        # user sees progress instead of silence during retrieval + rerank.
        yield _sse("stage", {"stage": "understanding", "detail": "Analyzing your question"})

        # v1.1.9 — MONITORING NL QUERY TOOL: Zabbix devices/servers + K8s/LGTM app status.
        # Deterministic intent match; answers real-time data without touching the KB/LLM path
        # (fast, accurate, rate-limit friendly).
        import re as _re
        _msg_l = req.message.lower()

        # v1.3.3 — PANEL-INDEX INTENT: before keyword patterns, check whether the
        # question naturally matches any Grafana panel title (users don't say
        # "grafana" — they just ask "what is the token cost?").
        try:
            from app.integrations.grafana import is_configured as _gf_cfg, match_question_to_panels
            if _gf_cfg():
                _panel_matches = match_question_to_panels(req.message, top_n=1)
                if _panel_matches and _panel_matches[0]["_score"] >= 4:
                    _mon_kind = "grafana"
                else:
                    _mon_kind = None
            else:
                _mon_kind = None
        except Exception:
            _mon_kind = None

        if not _mon_kind:
            _mon_patterns = [
                (r"(inventory|asset|serial number|who (is|has) .*assigned|which (laptop|server|printer))", "inventory"),
                (r"zabbix", "zabbix"),
                (r"grafana|dashboard", "grafana"),
                (r"(cpu|memory|ram).*(usage|consum|top|highest|most)|(top|highest|most).*(cpu|memory|ram)|pod.*(cpu|memory)", "top_pods"),
                (r"(which|what).*(device|server|host)s?\s+(are\s+)?(down|up|offline|online|unavailable)", "hosts"),
                (r"(device|server|host|network).*(status|health|up|down|available)", "status"),
                (r"(ingress|route|external url|domain entry)", "ingress"),
                (r"(service|svc).*(list|overview|all)|list.*(service|svc)", "services"),
                (r"(namespaces|namespaces overview|cluster overview|what namespaces)", "namespaces"),
                (r"(nodes?\s+(list|detail|overview|status)|how many nodes|node spec)", "nodes"),
                (r"(cluster|kubernetes|k8s|pod|node).*(status|health|running|down|restart)", "cluster"),
                (r"(is|are)\s+(the\s+)?(backend|frontend|ollama|redis|postgres|rerank)", "app"),
                (r"(active\s+)?(problems|alerts|incidents)", "problems"),
            ]
            _mon_kind = next((kind for pat, kind in _mon_patterns if _re.search(pat, _msg_l)), None)
        if _mon_kind:
            yield _sse("stage", {"stage": "tool", "detail": "Querying live monitoring data"})
            _answer_text, _mon_rows = _monitoring_answer(_mon_kind, req.message)
            _mid = str(uuid.uuid4())
            yield _sse("meta", {
                "domain": "monitoring", "confidence": 0.97, "decision": "answer",
                "tool_used": "monitoring", "rewritten": "",
                "hits": _mon_rows, "top_k": 0,
                "context_chars": len(_answer_text), "context_tokens_estimate": len(_answer_text) // 4,
                "context_truncated": False, "max_context_tokens": 0,
            })
            for _tok in _chunk_text(_answer_text):
                yield _sse("token", {"token": _tok})
            try:
                from app.observability.metrics import CHAT_REQUESTS_TOTAL, CHAT_LATENCY_SECONDS
                CHAT_REQUESTS_TOTAL.labels(domain="monitoring", decision="answer").inc()
                CHAT_LATENCY_SECONDS.labels(domain="monitoring", decision="answer").observe(time.time() - t0)
            except Exception:
                pass
            audit("chat.monitoring", user, "monitoring", 0.97, "answer")
            yield _sse("done", {"message_id": _mid, "latency_ms": int((time.time() - t0) * 1000),
                                "tool": "monitoring"})
            return

        # v0.21.70 — LangGraph orchestration (retry loop on weak retrieval).
        # Falls back to the linear pipeline if the graph fails for any reason.
        result = None
        graph_pending = False
        if os.environ.get("LANGGRAPH_ENABLED", "1") == "1":
            try:
                from app.graph_rag import run_rag_graph_stream
                from app.orchestration.orchestrator import RAGOrchestrationResult

                g: dict = {}
                for ev in run_rag_graph_stream(req.message, history=req.context,
                                               top_k=req.top_k, user=user,
                                               thread_id=session_id):
                    if isinstance(ev, tuple) and ev[0] == "__FINAL__":
                        g = ev[1]
                    else:
                        yield _sse("stage", {"stage": "graph", "detail": ev})
                graph_pending = bool(g.get("pending_approval"))
                graph_thread = req.session_id
                result = RAGOrchestrationResult(
                    domain=g["domain"], rewritten=g["rewritten"], docs=g["docs"],
                    confidence=g["confidence"], decision=g["decision"],
                    context=g["context"], sources=[
                        {"page_id": d.get("page_id"), "title": d["title"],
                         "confidence": d.get("confidence"), "source_url": d.get("source_url"),
                         "relevance": d.get("confidence")}
                        for d in g["docs"]
                    ], tool_used=g.get("tool_used"), tool_rows=g.get("ticket_rows") or [],
                    top_k=g["top_k"] or 5,
                    context_chars=len(g["context"]),
                    context_tokens_estimate=len(g["context"]) // 4,
                    context_truncated=False,
                )
                # v0.21.90 — ticket tool answered from the live DB: drop KB docs so
                # the UI shows ticket rows only (same contract as the linear path).
                if result.tool_used == "tickets" and result.tool_rows:
                    result.docs = []
                    result.sources = []
                    result.confidence = max(result.confidence, 0.95)
                yield _sse("stage", {"stage": "retrieval",
                                     "detail": ("Ticket status lookup (live)"
                                                if result.tool_used == "tickets"
                                                else f"LangGraph pass {g['retries']} — confidence {g['confidence']:.0%}")})
            except Exception as graph_err:
                logger.warning("langgraph path failed (%s) — falling back to linear pipeline", graph_err)
                result = None
        if result is None:
            result = run_rag(req.message, history=req.context, top_k=req.top_k, user=user)
        else:
            # v0.21.70 Phase 2 — graph paused for human approval?
            if graph_pending:
                import uuid as _uuid
                approval_id = str(_uuid.uuid4())
                from sqlalchemy import text as _txt
                from app.persistence.database import SessionLocal as _SL
                with _SL() as _s:
                    _s.execute(_txt(
                        "INSERT INTO approvals (id, username, question, status, created_at, thread_id) "
                        "VALUES (:i, :u, :q, 'pending', NOW(), :tid)"
                    ), {"i": approval_id, "u": user, "q": req.message, "tid": req.session_id})
                    _s.commit()
                # v0.21.92 — alert admins (SMTP) that an escalation awaits review
                try:
                    from app.notifier import send_alert
                    send_alert(
                        "approval_request",
                        "[iTH] Escalation awaiting approval",
                        f"User: {user}\nQuestion: {req.message}\n"
                        f"Approve/reject in Chat → approval queue.\n",
                        to_admins=True,
                    )
                except Exception:  # noqa: BLE001
                    pass
                yield _sse("approval_request", {
                    "approval_id": approval_id,
                    "thread_id": req.session_id,
                    "question": req.message,
                    "detail": "Escalation needs administrator approval",
                })
                yield _sse("done", {"message_id": str(_uuid.uuid4()),
                                    "latency_ms": int((time.time() - t0) * 1000)})
                return
        yield _sse("stage", {"stage": "generating", "detail": "Generating answer"})

        # Domain-scoped access (Phase 9): non-admin users only see their allowed domains.
        role = get_role(user)
        allowed = allowed_domains(role)
        if allowed is not None and result.domain not in allowed:
            result.decision = DECISION_CAUTION
            audit("domain_blocked", user, result.domain, result.confidence, detail=f"role={role}")

        # meta event — domain badge + confidence + retrieved sources + LLM-stage telemetry
        meta = {
            "domain": result.domain,
            "confidence": result.confidence,
            "decision": result.decision,
            "tool_used": result.tool_used,
            "rewritten": result.rewritten,
            # v0.18.4 — tool-answered questions show the tool's rows as sources
            # (never mix ticket rows with KB hits)
            "hits": (result.tool_rows if result.tool_used == "tickets" and result.tool_rows
                     else result.sources),
            # New: context-window + retriever tunables (visible to the UI)
            "top_k": result.top_k,
            "context_chars": result.context_chars,
            "context_tokens_estimate": result.context_tokens_estimate,
            "context_truncated": result.context_truncated,
            "max_context_tokens": int(SETTINGS.max_context_tokens),
        }
        if guardrail_flag:
            meta["guardrail_flagged"] = guardrail_flag  # toxic-abuse marker for audit/UI
        yield _sse("meta", meta)

        if result.decision == DECISION_CAUTION and not result.tool_used:
            yield _sse("caution", {"message": caution_message(), "confidence": result.confidence})

        # H-Chat generation (doc §3 ⑥). Answer = the assembled briefing.
        # `stream_answer` now yields (token, usage) pairs; usage is non-None only on the
        # LAST pair (a zero-length sentinel) so the consumer can pick it up exactly once.
        context = result.context or build_context(result.docs, result.rewritten)
        answer_parts: list[str] = []
        last_usage: dict | None = None
        from app.llm.client import get_active_model_name
        active_llm_model = get_active_model_name()

        # v1.1.1 — SERVER-kind request span so the Tempo service graph has a node
        # (the servicegraph connector only pairs CLIENT/SERVER span kinds).
        from app.observability.telemetry import start_quiet_span
        # start_quiet_span: SSE generator resumes in a different contextvars
        # Context per yield -> plain start_as_current_span logs a harmless
        # "Failed to detach context" ValueError on close. _quiet_span swallows it.
        with start_quiet_span("chat.request", kind="SERVER") as req_span:
            req_span.set_attribute("chat.domain", result.domain or "general")
            with start_span("chat.stream.llm") as span:
                span.set_attribute("rag.confidence", result.confidence)
                span.set_attribute("rag.decision", result.decision)
                span.set_attribute("llm.model", active_llm_model)
                for tok, usage in stream_answer(req.message, context):
                    if usage is not None:
                        # The last (zero-length) token carries the final usage dict.
                        last_usage = usage
                        continue
                    if not tok:
                        continue
                    answer_parts.append(tok)
                    yield _sse("token", {"token": tok})
                if last_usage is not None:
                    span.set_attribute("llm.input_tokens", last_usage.get("input_tokens", 0))
                    span.set_attribute("llm.output_tokens", last_usage.get("output_tokens", 0))
                    span.set_attribute("llm.total_tokens", last_usage.get("total_tokens", 0))

        answer = "".join(answer_parts)
        # Stamp LLM usage + RAG tunables onto the persisted meta so they survive
        # conversation reloads (the SSE `meta` event has the live ones, but we
        # store a snapshot too so a re-opened chat can show usage under old answers).
        if last_usage is not None:
            meta["usage"] = last_usage
        meta["top_k"] = result.top_k
        meta["context_tokens_estimate"] = result.context_tokens_estimate
        meta["context_chars"] = result.context_chars
        if s is not None:
            try:
                _am = ChatMessage(session_id=session_id, role="assistant", content=answer, meta=json.dumps(meta))
                s.add(_am)
                s.commit()
                db_msg_id = str(_am.id)  # v0.21.90 — real row id so feedback can reference it
                s.close()
            except Exception as exc:
                db_msg_id = ""
                logger.warning(f"persist assistant turn skipped ({type(exc).__name__}): {exc}")

        message_id = db_msg_id or str(uuid.uuid4())
        from app.observability.metrics import CHAT_REQUESTS_TOTAL, CHAT_LATENCY_SECONDS
        CHAT_REQUESTS_TOTAL.labels(domain=result.domain or "general", decision=result.decision).inc()
        CHAT_LATENCY_SECONDS.labels(domain=result.domain or "general", decision=result.decision).observe(time.time() - t0)
        audit("chat", user, result.domain, result.confidence, result.decision)

        # Record LLM Observability Metrics (Tokens, Cost, Confidence Gate)
        try:
            from app.observability.metrics import (
                RAG_CONFIDENCE_SCORE,
                RAG_GATE_DECISIONS,
                record_token_and_cost,
            )
            RAG_CONFIDENCE_SCORE.labels(domain=result.domain or "general").observe(result.confidence)
            RAG_GATE_DECISIONS.labels(decision=result.decision, domain=result.domain or "general").inc()
            if last_usage is not None:
                record_token_and_cost(
                    model=active_llm_model,
                    input_tokens=int(last_usage.get("input_tokens", 0)),
                    output_tokens=int(last_usage.get("output_tokens", 0)),
                )
        except Exception as exc:
            logger.debug("Failed to update observability metrics: %s", exc)

        # Echo LLM usage + RAG tunables on the terminal event so the frontend can
        # show a compact "Usage" pill under the answer.
        done_payload: dict = {"message_id": message_id, "latency_ms": int((time.time() - t0) * 1000)}
        if last_usage is not None:
            done_payload["usage"] = last_usage
        done_payload["top_k"] = result.top_k
        done_payload["context_tokens_estimate"] = result.context_tokens_estimate
        yield _sse("done", done_payload)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@router.post("/api/escalate")
@limit("escalate")
def escalate(req: EscalateRequest, user: str = Depends(get_current_user)) -> dict:
    """Phase 6 — create a Jira ticket AS the authenticated user (reporter=username)."""
    summary = (req.message or "IT help escalation").strip()[:120]
    transcript = "\n".join(
        f"{m.get('role')}: {m.get('content')}" for m in req.transcript if m.get("content")
    )
    description = (
        f"Domain: {req.domain or 'unknown'}\n"
        f"Confidence: {req.confidence}\n"
        f"Transcript:\n{transcript}"
    )
    try:
        route = jira_route(req.domain)
        result = jira_escalate(summary, description, reporter=user,
                               project=route.get("project") if isinstance(route, dict) else route,
                               assignee=route.get("assignee") if isinstance(route, dict) else None,
                               domain=req.domain)
    except Exception as exc:
        logger.exception("escalate failed")
        result = {"link": "", "mode": "error", "jira_key": None, "reporter": user,
                  "error": f"{type(exc).__name__}: {exc}"}
    audit("escalate", user, req.domain, req.confidence, detail=result.get("jira_key"))

    # Persist the escalation log (best-effort).
    try:
        from app.persistence.database import SessionLocal
        from app.persistence.models import JiraTicket

        s = SessionLocal()
        s.add(JiraTicket(session_id=req.session_id, jira_key=result.get("jira_key"),
                         domain=req.domain, status="created", created_by=user))
        s.commit()
        s.close()
    except Exception as exc:
        logger.warning(f"persist jira ticket skipped ({type(exc).__name__}): {exc}")

    return result


@router.post("/api/feedback")
def feedback(req: FeedbackRequest, user: str = Depends(get_current_user)) -> dict:
    """Record Helpful / Not Helpful (design doc §7)."""
    from app.persistence.database import SessionLocal

    s = SessionLocal()
    fb = Feedback(message_id=req.message_id, rating=req.rating, comment=req.comment)
    s.add(fb)
    s.commit()
    s.close()
    audit("feedback", user, detail=f"message_id={req.message_id} rating={req.rating}")

    try:
        from app.observability.metrics import USER_FEEDBACK_TOTAL
        label = "helpful" if req.rating > 0 else "not_helpful"
        USER_FEEDBACK_TOTAL.labels(rating=label).inc()
    except Exception as exc:
        logger.debug("Failed to record feedback metric: %s", exc)

    return {"status": "ok", "saved": True, "rating": req.rating}


@router.get("/api/escalations")
def list_escalations(user: str = Depends(get_current_user)) -> dict:
    """Phase 6 — list the current user's escalation (Jira) tickets, newest first."""
    try:
        from app.persistence.database import SessionLocal
        from app.persistence.models import JiraTicket

        s = SessionLocal()
        rows = (s.query(JiraTicket)
                  .filter(JiraTicket.created_by == user)
                  .order_by(JiraTicket.created_at.desc())
                  .limit(50).all())
        _base = SETTINGS.jira_base_url.rstrip("/") if SETTINGS.jira_base_url else ""
        out = [{"id": t.id, "jira_key": t.jira_key, "domain": t.domain,
                "status": t.status, "created_at": t.created_at.isoformat(),
                "link": f"{_base}/browse/{t.jira_key}" if (_base and t.jira_key) else None,
                "session_id": str(t.session_id) if t.session_id else None}
               for t in rows]
        s.close()
        return {"escalations": out}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"escalations unavailable: {type(exc).__name__}")


@router.get("/api/contacts/{domain}")
def contacts(domain: str, user: str = Depends(get_current_user)) -> dict:
    return get_contact(domain)


# ---------------------------------------------------------------------------
# v1.3.4 — GRAFANA SELECT-FLOW: question → panel choices popup → user picks →
# live data → LLM generates the final narrative answer.
# ---------------------------------------------------------------------------

@router.post("/api/grafana/panels")
def grafana_panel_choices(body: dict, user: str = Depends(get_current_user)) -> dict:
    """Match a natural-language question to candidate Grafana panels.

    Returns a list of choices the frontend renders as a selectable popup.
    """
    from app.integrations import grafana as gf
    if not gf.is_configured():
        raise HTTPException(status_code=503, detail="Grafana integration not configured")
    question = (body.get("question") or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="question required")
    matches = gf.match_question_to_panels(question, top_n=6)
    return {"choices": [
        {
            "dashboard_uid": m["dashboard_uid"],
            "dashboard_title": m["dashboard_title"],
            "panel_title": m["title"],
            "expr": m["expr"],
            "legend": m.get("legend", ""),
            "score": m["_score"],
        } for m in matches
    ]}


@router.post("/api/grafana/panel-data")
def grafana_panel_data(body: dict, user: str = Depends(get_current_user)) -> dict:
    """Execute one panel's PromQL and return formatted rows for the LLM.

    body: { dashboard_uid, dashboard_title, panel_title, expr, legend }
    """
    from app.integrations import grafana as gf
    if not gf.is_configured():
        raise HTTPException(status_code=503, detail="Grafana integration not configured")
    expr = (body.get("expr") or "").strip()
    panel_title = (body.get("panel_title") or "Panel").strip()
    dashboard_title = (body.get("dashboard_title") or "Dashboard").strip()
    if not expr:
        raise HTTPException(status_code=400, detail="expr required")
    try:
        res = gf.run_prom_query(expr)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Prometheus query failed: {type(exc).__name__}: {exc}")
    rows = []
    for item in res:
        metric = gf.metric_of(item)
        # strip __name__ noise; keep meaningful labels
        labels = {k: v for k, v in metric.items() if k not in ("__name__",)}
        value = float(item.get("value", [0, 0])[1])
        rows.append({"labels": labels, "value": value})
    return {
        "panel_title": panel_title,
        "dashboard_title": dashboard_title,
        "expr": expr,
        "series_count": len(res),
        "rows": rows[:30],
    }

