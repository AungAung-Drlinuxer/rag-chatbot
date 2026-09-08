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
from app.observability.telemetry import record_counter, record_histogram, start_span
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


@router.post("/api/chat/stream")
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
        yield _sse("meta", meta)

        if result.decision == DECISION_CAUTION and not result.tool_used:
            yield _sse("caution", {"message": caution_message(), "confidence": result.confidence})

        # H-Chat generation (doc §3 ⑥). Answer = the assembled briefing.
        # `stream_answer` now yields (token, usage) pairs; usage is non-None only on the
        # LAST pair (a zero-length sentinel) so the consumer can pick it up exactly once.
        context = result.context or build_context(result.docs, result.rewritten)
        answer_parts: list[str] = []
        last_usage: dict | None = None
        with start_span("chat.stream.llm") as span:
            span.set_attribute("rag.confidence", result.confidence)
            span.set_attribute("rag.decision", result.decision)
            span.set_attribute("llm.model", SETTINGS.hchat_model or "minimax/minimax-m3:free")
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
        record_counter("chat_requests_total", 1, {"domain": result.domain, "decision": result.decision})
        record_histogram("chat_latency_seconds", time.time() - t0, {"domain": result.domain, "decision": result.decision})
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
                    model=SETTINGS.hchat_model or "minimax/minimax-m3:free",
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

