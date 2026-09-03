"""Chat HTTP routes — SSE streaming, conversations, escalation, feedback."""
from __future__ import annotations

import json
import logging
import os
import time
import uuid

from fastapi import APIRouter, Depends

from app.core.config import SETTINGS
from app.core.dependencies import allowed_domains, get_current_user, get_role, require_chatbot
from app.llm import stream_answer
from app.observability.audit import audit
from app.observability.telemetry import record_counter, record_histogram, start_span
from app.persistence.repositories import conversations
from app.rag import build_context
from app.rag.gate import DECISION_CAUTION, caution_message
from app.schemas import ChatRequest

logger = logging.getLogger("it-help-chatbot")

router = APIRouter(tags=["chat"])


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/api/chat/stream")
def chat_stream(req: ChatRequest, user: str = Depends(require_chatbot)):
    """Design doc §3 single pipeline, streamed over SSE.

    Events: meta (domain/confidence/decision/hits) → token* → done.
    """
    from fastapi.responses import StreamingResponse

    session_id = req.session_id or str(uuid.uuid4())

    def gen():
        t0 = time.time()
        # Persist the user turn (best-effort; must not break the stream).
        try:
            s = conversations.ensure_session(session_id, user)
            conversations.append_message(s, session_id=session_id, role="user", content=req.message)
        except Exception as exc:
            logger.warning(f"persist user turn skipped ({type(exc).__name__}): {exc}")
            s = None

        # Stage feedback (v0.16.4): tell the client what the pipeline is doing so the
        # user sees progress instead of silence during retrieval + rerank.
        yield _sse("stage", {"stage": "understanding", "detail": "Analyzing your question"})
        # v0.21.70 — LangGraph orchestration (retry loop on weak retrieval).
        # Falls back to the linear pipeline if the graph fails for any reason.
        from app.orchestration import RAGOrchestrationResult, run_rag
        result = None
        graph_pending = False
        if os.environ.get("LANGGRAPH_ENABLED", "1") == "1":
            try:
                from app.orchestration.graph import run_rag_graph_stream

                g: dict = {}
                for ev in run_rag_graph_stream(req.message, history=req.context,
                                               top_k=req.top_k, user=user,
                                               thread_id=session_id):
                    if isinstance(ev, tuple) and ev[0] == "__FINAL__":
                        g = ev[1]
                    else:
                        yield _sse("stage", {"stage": "graph", "detail": ev})
                graph_pending = bool(g.get("pending_approval"))
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
        elif graph_pending:
            approval_id = str(uuid.uuid4())
            _record_approval(approval_id, user, req.message, req.session_id)
            # v0.21.92 — alert admins (SMTP) that an escalation awaits review
            try:
                from app.integrations.notifier import send_alert
                send_alert(
                    "approval_request",
                    "[iTH] Escalation awaiting approval",
                    f"User: {user}\nQuestion: {req.message}\n"
                    f"Approve/reject in Chat → approval queue.\n",
                    to_admins=True,
                )
            except Exception:
                pass
            yield _sse("approval_request", {
                "approval_id": approval_id,
                "thread_id": req.session_id,
                "question": req.message,
                "detail": "Escalation needs administrator approval",
            })
            yield _sse("done", {"message_id": str(uuid.uuid4()),
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
            "hits": (result.tool_rows if result.tool_used == "tickets" and result.tool_rows
                     else result.sources),
            "top_k": result.top_k,
            "context_chars": result.context_chars,
            "context_tokens_estimate": result.context_tokens_estimate,
            "context_truncated": result.context_truncated,
            "max_context_tokens": int(SETTINGS.max_context_tokens),
        }
        yield _sse("meta", meta)

        if result.decision == DECISION_CAUTION and not result.tool_used:
            yield _sse("caution", {"message": caution_message(), "confidence": result.confidence})

        # H-Chat generation (doc §3 ⑥). stream_answer yields (token, usage) pairs;
        # usage is non-None only on the LAST pair (a zero-length sentinel).
        context = result.context or build_context(result.docs, result.rewritten)
        answer_parts: list[str] = []
        last_usage: dict | None = None
        with start_span("chat.stream.llm") as span:
            span.set_attribute("rag.confidence", result.confidence)
            span.set_attribute("rag.decision", result.decision)
            span.set_attribute("llm.model", SETTINGS.hchat_model or "minimax/minimax-m3:free")
            for tok, usage in stream_answer(req.message, context):
                if usage is not None:
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
        if last_usage is not None:
            meta["usage"] = last_usage
        meta["top_k"] = result.top_k
        meta["context_tokens_estimate"] = result.context_tokens_estimate
        meta["context_chars"] = result.context_chars
        db_msg_id = ""
        if s is not None:
            try:
                _am = conversations.append_message(
                    s, session_id=session_id, role="assistant",
                    content=answer, meta=json.dumps(meta))
                db_msg_id = str(_am.id)  # v0.21.90 — real row id so feedback can reference it
            except Exception as exc:
                logger.warning(f"persist assistant turn skipped ({type(exc).__name__}): {exc}")
            finally:
                try:
                    s.close()
                except Exception:
                    pass

        message_id = db_msg_id or str(uuid.uuid4())
        record_counter("chat_requests_total", 1, {"domain": result.domain, "decision": result.decision})
        record_histogram("chat_latency_seconds", time.time() - t0, {"domain": result.domain, "decision": result.decision})
        audit("chat", user, result.domain, result.confidence, result.decision)
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


def _record_approval(approval_id: str, user: str, question: str, thread_id) -> None:
    from sqlalchemy import text

    from app.persistence.database import SessionLocal

    with SessionLocal() as s:
        s.execute(text(
            "INSERT INTO approvals (id, username, question, status, created_at, thread_id) "
            "VALUES (:i, :u, :q, 'pending', NOW(), :tid)"
        ), {"i": approval_id, "u": user, "q": question, "tid": thread_id})
        s.commit()


@router.get("/api/conversations")
def list_conversations(user: str = Depends(get_current_user), limit: int = 20) -> dict:
    """Recent conversations for the current user (RECENT CONVERSATIONS sidebar)."""
    return {"conversations": conversations.recent(user, limit=limit)}


@router.patch("/api/conversations/{session_id}")
def update_conversation(session_id: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """v0.21.38 — rename / pin a conversation (owner only)."""
    from fastapi import HTTPException

    title = payload.get("title", ...) if "title" in payload else ...
    pinned = payload.get("is_pinned", ...) if "is_pinned" in payload else ...
    try:
        updated = conversations.update(session_id, user, title=title, is_pinned=pinned)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session id")
    if updated is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True, **updated}


@router.get("/api/conversations/{session_id}/messages")
def conversation_messages(session_id: str, user: str = Depends(get_current_user)) -> dict:
    """Load a conversation's full message history (sidebar click → reload chat)."""
    from fastapi import HTTPException

    try:
        msgs = conversations.messages(session_id, user, caution_builder=caution_message)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    if msgs is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"session_id": session_id, "messages": msgs}


@router.delete("/api/conversations")
def clear_conversations(user: str = Depends(get_current_user)) -> dict:
    """Clear the current user's conversations (cascade their messages)."""
    return {"deleted": conversations.clear_all(user)}


@router.delete("/api/conversations/{session_id}")
def delete_conversation(session_id: str, user: str = Depends(get_current_user)) -> dict:
    """Delete ONE conversation owned by the current user (cascades messages)."""
    from fastapi import HTTPException

    try:
        deleted = conversations.delete_one(session_id, user)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid session id")
    if not deleted:
        raise HTTPException(status_code=404, detail="conversation not found")
    return {"deleted": 1}

