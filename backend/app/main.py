"""FastAPI app — IT Help Chatbot (Phase 1 MVP). SSE chat relay + supporting routes."""
from __future__ import annotations

import json
import logging
import os
import re
import time
import os
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.observability.audit import audit
from app.auth.deps import get_current_user
from app.auth.jwt import create_access_token, create_refresh_token
from app.auth.ldap_auth import authenticate
from app.auth.rbac import require_cap  # noqa
from app.auth.rbac import allowed_domains, get_role, jira_route, require_role
from app.config import SETTINGS
from app.persistence.database import init_db
from app.rag.gate import DECISION_CAUTION, caution_message
from app.integrations.contacts import get_contact
from app.integrations.jira import escalate as jira_escalate
from app.llm.client import stream_answer
from app.persistence.models import ChatMessage, ChatSession, Feedback, UserSettings
from app.orchestration.orchestrator import run_rag
from app.rag.retrieval import build_context
from app.schemas import (
    ArticleDraftRequest,
    ArticleRequest,
    ArticleSearchRequest,
    ChatRequest,
    EscalateRequest,
    FeedbackRequest,
    LoginRequest,
    RefreshRequest,
)
from app.observability.telemetry import record_counter, record_histogram, setup_telemetry, start_span

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("it-help-chatbot")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    setup_telemetry()  # Phase 8 — best-effort (no-op when LGTM endpoints not configured)
    # v0.21.54 — preload the reranker at startup (model is baked into the image,
    # so this is ~5s from local cache). Without it, the first user request pays
    # the load cost and the HPA misreads that CPU burst as traffic.
    # v0.22.x — skip in remote mode: scoring lives in rerank-svc, and a model
    # download/load attempt would only waste startup CPU.
    try:
        import threading

        if SETTINGS.rerank_mode == "remote":
            logger.info("rerank_mode=remote — skipping local reranker preload")
        else:
            from app.rag.reranker import _get_model
            threading.Thread(target=_get_model, daemon=True).start()
            logger.info("reranker preload started (background)")
    except Exception as exc:
        logger.warning("reranker preload skipped: %s", exc)
    yield


app = FastAPI(title="IT Help Chatbot", version="0.2.0", lifespan=lifespan)

# CORS — allow the Tauri + web/dev frontend origins (Phase 10)
_origins = [o.strip() for o in SETTINGS.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.dashboard import router as dashboard_router

app.include_router(dashboard_router)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "env": SETTINGS.app_env, "conf_threshold": SETTINGS.confidence_gate_threshold}


@app.post("/api/auth/login")
def login(req: LoginRequest) -> dict:
    """LDAP/AD authenticate (Phase 5) → JWT access + refresh tokens (dev fallback: dev/dev)."""
    subject = authenticate(req.username, req.password)
    if not subject:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    # v0.21.96 — LDAP registration gate: identity verified but account not yet
    # approved by an administrator → complete login is refused with a clear reason.
    if subject.startswith("pending:"):
        who = subject.split(":", 1)[1]
        raise HTTPException(
            status_code=403,
            detail=("Registration pending — your AD account was verified, but an "
                    "administrator must approve it on the Users page before you can "
                    "sign in. (Requested as " + who + ")"),
        )
    # v0.21.57 — hard block at login for admin-disabled users (covers the dev
    # backdoor path too, which bypasses the LDAP upsert check).
    from app.auth.rbac import is_disabled
    if is_disabled(subject):
        logger.warning("login refused: %s is disabled", subject)
        raise HTTPException(
            status_code=403,
            detail="Your account has been disabled by an administrator. Please contact IT.",
        )
    # v0.21.58 — record the real login time (Users page 'Last login' column)
    try:
        from sqlalchemy import text as _lt

        from app.persistence.database import SessionLocal as _SL

        with _SL() as _s:
            _s.execute(_lt(
                "INSERT INTO users (username, last_login) VALUES (:u, NOW()) "
                "ON CONFLICT (username) DO UPDATE SET last_login = NOW(), last_seen = NOW()"
            ), {"u": subject})
            _s.commit()
    except Exception as _e:
        logger.warning("last_login update skipped: %s", _e)
    audit("login", subject)
    return {
        "access_token": create_access_token(subject),
        "refresh_token": create_refresh_token(subject),
        "token_type": "bearer",
        "username": subject,
    }


@app.post("/api/auth/refresh")
def refresh_token(req: RefreshRequest) -> dict:
    """Exchange a valid refresh token for a new access token (v0.18.1)."""
    from app.auth.jwt import create_access_token, decode_token

    try:
        subject = decode_token(req.refresh_token, expected_type="refresh")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    # v0.21.50 — also block refresh for disabled users
    try:
        from sqlalchemy import text as _t
        from app.persistence.database import SessionLocal
        with SessionLocal() as s:
            row = s.execute(_t("SELECT status FROM users WHERE username = :u"), {"u": subject}).first()
        if row and row[0] == "Disabled":
            raise HTTPException(
                status_code=403,
                detail="Account is disabled — please contact your administrator",
            )
    except HTTPException:
        raise
    except Exception:
        pass
    return {"access_token": create_access_token(subject), "username": subject}


@app.get("/api/auth/me")
def me(user: str = Depends(get_current_user)) -> dict:
    """Current user + RBAC role (Phase 9) — lets the client show/hide admin UI.

    v0.21.57 — role now honours the admin-set role_override, and we return the
    resolved capability map + display role so the frontend can gate navigation and
    explain *why* something is blocked ("Your role (User) cannot create tickets").
    """
    from app.auth.rbac import (
        CAPABILITIES,
        _MATRIX_ROLE_FOR,
        effective_role,
        permissions_for,
    )

    role = effective_role(user)
    perms = permissions_for(user)
    return {
        "username": user,
        "role": role,
        "displayRole": _MATRIX_ROLE_FOR.get(role, "User"),
        "permissions": perms,
        "capabilityLabels": CAPABILITIES,
    }


# v0.21.57 — capability-gated endpoints give a clear 403 the UI can show
_require_chatbot = require_cap("chatbot")

@app.post("/api/chat/stream")
def chat_stream(req: ChatRequest, user: str = Depends(_require_chatbot)) -> StreamingResponse:
    """Design doc §3 single pipeline, streamed over SSE.

    Events: meta (domain/confidence/decision/hits) → token* → done.
    """
    session_id = req.session_id or str(uuid.uuid4())

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


@app.get("/api/conversations")
def list_conversations(user: str = Depends(get_current_user), limit: int = 20) -> dict:
    """Recent conversations for the current user (RECENT CONVERSATIONS sidebar)."""
    from sqlalchemy import func

    from app.persistence.database import SessionLocal

    s = SessionLocal()
    try:
        rows = (
            s.query(
                ChatSession.id,
                func.max(ChatMessage.created_at).label("last_at"),
                func.count(ChatMessage.id).label("messages"),
                ChatSession.title,
                ChatSession.is_pinned,
            )
            .join(ChatMessage, ChatMessage.session_id == ChatSession.id)
            .filter(ChatSession.username == user)
            .group_by(ChatSession.id)
            .order_by(ChatSession.is_pinned.desc(), func.max(ChatMessage.created_at).desc(), ChatSession.id)
            .limit(limit)
            .all()
        )
        convs = []
        for r in rows:
            session_title = r[3]
            first = (
                s.query(ChatMessage.content)
                .filter(ChatMessage.session_id == r[0], ChatMessage.role == "user")
                .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
                .first()
            )
            fallback = (first[0][:80] + "…") if first and len(first[0]) > 80 else (first[0] if first else "New conversation")
            title = (session_title[:80] + "…") if session_title and len(session_title) > 80 else (session_title or fallback)
            convs.append({
                "session_id": str(r[0]),
                "title": title,
                "last_at": r[1].isoformat() if r[1] else None,
                "messages": r[2],
                "is_pinned": bool(r[4]),
            })
        return {"conversations": convs}
    finally:
        s.close()


@app.patch("/api/conversations/{session_id}")
def update_conversation(session_id: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """v0.21.38 — rename / pin a conversation (owner only)."""
    from app.persistence.database import SessionLocal
    from app.persistence.models import ChatSession
    from uuid import UUID as _UUID
    try:
        sid = _UUID(session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session id")
    with SessionLocal() as s:
        sess = s.get(ChatSession, sid)
        if sess is None or sess.username != user:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if "title" in payload:
            title = (payload.get("title") or "").strip()[:200]
            sess.title = title or None
        if "is_pinned" in payload:
            sess.is_pinned = bool(payload.get("is_pinned"))
        s.commit()
    return {"ok": True, "title": sess.title, "is_pinned": sess.is_pinned}


@app.get("/api/conversations/{session_id}/messages")
def conversation_messages(session_id: str, user: str = Depends(get_current_user)) -> dict:
    """Load a conversation's full message history (sidebar click → reload chat)."""
    import uuid as _uuid

    from app.persistence.database import SessionLocal

    try:
        sid = _uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    s = SessionLocal()
    try:
        sess = s.get(ChatSession, sid)
        if sess is None or sess.username != user:
            raise HTTPException(status_code=404, detail="Conversation not found")
        rows = (
            s.query(ChatMessage)
            .filter(ChatMessage.session_id == sid)
            .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            .all()
        )
        messages = []
        for m in rows:
            meta = None
            caution = None
            if m.role == "assistant" and m.meta:
                try:
                    meta = json.loads(m.meta)
                except (ValueError, TypeError):
                    meta = None
                if meta and meta.get("decision") == DECISION_CAUTION:
                    caution = caution_message()
            messages.append({
                "role": m.role,
                "content": m.content,
                "meta": meta,
                "caution": caution,
                "message_id": str(m.id),  # v0.21.90 — real row id so feedback survives reload
            })
        return {"session_id": session_id, "messages": messages}
    finally:
        s.close()


@app.delete("/api/conversations")
def clear_conversations(user: str = Depends(get_current_user)) -> dict:
    """Clear the current user's conversations (cascade their messages)."""
    from app.persistence.database import SessionLocal

    s = SessionLocal()
    try:
        ids = [r[0] for r in s.query(ChatSession.id).filter(ChatSession.username == user).all()]
        if ids:
            s.query(ChatMessage).filter(ChatMessage.session_id.in_(ids)).delete(synchronize_session=False)
            s.query(ChatSession).filter(ChatSession.id.in_(ids)).delete(synchronize_session=False)
            s.commit()
        return {"deleted": len(ids)}
    finally:
        s.close()


@app.delete("/api/conversations/{session_id}")
def delete_conversation(session_id: str, user: str = Depends(get_current_user)) -> dict:
    """Delete ONE conversation owned by the current user (cascades messages)."""
    from uuid import UUID as UUIDType

    from app.persistence.database import SessionLocal

    try:
        sid = UUIDType(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid session id")

    s = SessionLocal()
    try:
        row = s.get(ChatSession, sid)
        if not row or row.username != user:
            raise HTTPException(status_code=404, detail="conversation not found")
        s.query(ChatMessage).filter(ChatMessage.session_id == sid).delete(synchronize_session=False)
        s.delete(row)
        s.commit()
        return {"deleted": 1}
    finally:
        s.close()


@app.post("/api/escalate")
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


@app.post("/api/feedback")
def feedback(req: FeedbackRequest, user: str = Depends(get_current_user)) -> dict:
    """Record Helpful / Not Helpful (design doc §7)."""
    from app.persistence.database import SessionLocal

    s = SessionLocal()
    fb = Feedback(message_id=req.message_id, rating=req.rating, comment=req.comment)
    s.add(fb)
    s.commit()
    s.close()
    audit("feedback", user, detail=f"message_id={req.message_id} rating={req.rating}")
    return {"status": "ok", "saved": True, "rating": req.rating}


@app.get("/api/escalations")
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


@app.post("/api/articles/search")
def articles_search(req: ArticleSearchRequest, user: str = Depends(get_current_user)) -> dict:
    """Return KB articles for the user to select (design doc §7, Phase 1)."""
    from app.rag.retrieval import retrieve

    try:
        docs = retrieve(req.query, domain=req.domain, k=req.top_k)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"retrieval unavailable: {type(exc).__name__}")
    return {
        "query": req.query,
        "domain": req.domain,
        "articles": [{"title": d["title"], "confidence": d["confidence"],
                      "source_url": d["source_url"], "domain": d["domain"]} for d in docs],
    }


@app.get("/api/contacts/{domain}")
def contacts(domain: str, user: str = Depends(get_current_user)) -> dict:
    return get_contact(domain)


@app.post("/api/articles/sync")
def articles_sync(user: str = Depends(get_current_user),
                  role: str = Depends(require_role("admin", "agent"))) -> dict:
    """Trigger a KB sync (Phase 7 — from all configured sources)."""
    from app.knowledge.ingest import sync_all

    audit("sync", user, detail="kb_sync")
    return sync_all(updated_by=user)


@app.post("/api/articles/draft")
def article_draft(req: ArticleDraftRequest, user: str = Depends(get_current_user),
                  role: str = Depends(require_role("admin", "agent"))) -> dict:
    """AI writing assist — generate a KB article draft for the given topic/domain."""
    from app.orchestration.orchestrator import answer_chain

    prompt = (
        "You are an internal IT knowledge-base author. Write a concise, practical "
        f"KB article in Confluence style about: {req.topic} (domain: {req.domain}).\n"
        "Structure it with: Overview, Steps (numbered), Verification, and Troubleshooting. "
        "Keep it factual and generic to the domain. Max ~300 words."
    )
    try:
        text = answer_chain().invoke(
            {"context": "(no retrieved documents — draft from domain knowledge)",
             "question": prompt}
        )
        return {"draft": text}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"draft generation failed: {type(exc).__name__}")


@app.post("/api/articles")
def article_create(req: ArticleRequest, user: str = Depends(get_current_user),
                   role: str = Depends(require_role("admin", "agent"))) -> dict:
    """Add a KB article — v0.19.0: writes to Confluence (domain section) when
    the space is configured, then ingests locally. Falls back to local-only
    (page_id kept) if the Confluence write fails."""
    from app.knowledge.ingest import ingest_article
    from app.integrations.confluence_write import create_kb_page

    confluence = create_kb_page(req.title, req.body, req.domain)

    page_id = req.page_id
    source_url = req.source_url
    if confluence.get("ok"):
        page_id = confluence["page_id"]
        source_url = confluence.get("url") or source_url

    payload = req.model_dump()
    payload["page_id"] = page_id
    payload["source_url"] = source_url
    status = ingest_article(payload)
    return {
        "status": status,
        "page_id": page_id,
        "confluence": confluence,
    }


@app.put("/api/articles/{page_id}")
def article_update(page_id: str, req: ArticleRequest, user: str = Depends(get_current_user),
                   role: str = Depends(require_role("admin", "agent"))) -> dict:
    """Update a KB article (change-detected → re-embed)."""
    from app.knowledge.ingest import ingest_article

    return {"status": ingest_article({**req.model_dump(), "page_id": page_id, "updated_by": user}), "page_id": page_id}


@app.get("/api/articles-domains")
def article_domains(user: str = Depends(get_current_user)) -> dict:
    """Domain browse cards for the Knowledge tab (counts from kb_meta, RBAC-filtered)."""
    from sqlalchemy import text as _text

    from app.auth.rbac import allowed_domains, get_role
    from app.persistence.database import SessionLocal

    with SessionLocal() as s:
        rows = s.execute(_text(
            "SELECT domain, count(*) AS pages, max(last_synced) AS last_synced "
            "FROM kb_meta GROUP BY domain ORDER BY pages DESC"
        )).mappings().all()
    allowed = allowed_domains(get_role(user))
    domains = [
        {"domain": r["domain"] or "general", "pages": r["pages"],
         "last_synced": r["last_synced"].isoformat() if r["last_synced"] else None}
        for r in rows if allowed is None or (r["domain"] or "general") in allowed
    ]
    return {"domains": domains}


@app.get("/api/articles-recent")
def articles_recent(limit: int = 8, user: str = Depends(get_current_user)) -> dict:
    """Recently updated KB pages (Knowledge tab section B)."""
    from sqlalchemy import text as _text

    from app.auth.rbac import allowed_domains, get_role
    from app.persistence.database import SessionLocal

    limit = max(1, min(limit, 25))
    with SessionLocal() as s:
        rows = s.execute(_text(
            "SELECT title, domain, source_url, updated_by, last_synced "
            "FROM kb_meta WHERE title IS NOT NULL "
            "ORDER BY last_synced DESC LIMIT :lim"
        ), {"lim": limit}).mappings().all()
    allowed = allowed_domains(get_role(user))
    articles = [
        {"title": r["title"], "domain": r["domain"] or "general", "source_url": r["source_url"],
         "updated_by": r["updated_by"], "last_synced": r["last_synced"].isoformat() if r["last_synced"] else None}
        for r in rows if allowed is None or (r["domain"] or "general") in allowed
    ]
    return {"articles": articles}


@app.get("/api/articles-list")
def articles_list(domain: str | None = None, q: str | None = None, limit: int = 50,
                  user: str = Depends(get_current_user)) -> dict:
    """Paged KB list for the Manage table (no vector calls; kb_meta only)."""
    from sqlalchemy import text as _text

    from app.auth.rbac import allowed_domains, get_role
    from app.persistence.database import SessionLocal

    limit = max(1, min(limit, 200))
    allowed = allowed_domains(get_role(user))
    if allowed is not None:
        if domain and domain not in allowed:
            return {"articles": [], "total": 0}
        domains = sorted(allowed)
    else:
        domains = None
    where = ["1=1"]
    params: dict = {"lim": limit}
    if domain:
        where.append("domain = :dom")
        params["dom"] = domain
    if q:
        where.append("(title ILIKE :q OR coalesce(body,'') ILIKE :q)")
        params["q"] = f"%{q}%"
    if domains is not None:
        where.append("coalesce(domain,'general') = ANY(:doms)")
        params["doms"] = domains
    sql = ("SELECT page_id, title, domain, source_url, updated_by, last_synced "
           f"FROM kb_meta WHERE {' AND '.join(where)} "
           "ORDER BY last_synced DESC NULLS LAST LIMIT :lim")
    with SessionLocal() as s:
        rows = s.execute(_text(sql), params).mappings().all()
    articles = [
        {"page_id": r["page_id"], "title": r["title"], "domain": r["domain"] or "general",
         "source_url": r["source_url"], "updated_by": r["updated_by"],
         "last_synced": r["last_synced"].isoformat() if r["last_synced"] else None}
        for r in rows
    ]
    return {"articles": articles, "total": len(articles)}


@app.get("/api/sync-status")
def sync_status(user: str = Depends(get_current_user)) -> dict:
    """Last sync snapshot + next beat ETA (Knowledge tab header/health strip)."""
    import json as _json

    from sqlalchemy import text as _text

    from app.persistence.database import SessionLocal
    from app.persistence.models import RuntimeKv

    with SessionLocal() as s:
        kv = s.get(RuntimeKv, "kb_last_sync")
        pages = s.execute(_text("SELECT count(*) FROM kb_meta")).scalar() or 0
    snap = _json.loads(kv.value) if kv and kv.value else None
    return {
        "pages": pages,
        "last_run": snap,
        "healthy": bool(snap),
        "beat_interval_minutes": 30,  # workers/celery_app.py beat schedule
    }


@app.delete("/api/articles/{page_id}")
def article_delete(page_id: str, user: str = Depends(get_current_user),
                   role: str = Depends(require_role("admin", "agent"))) -> dict:
    """Remove a KB article (vectors + sync meta)."""
    from app.persistence.database import SessionLocal
    from app.knowledge.ingest import _delete_vectors
    from app.persistence.models import KbMeta

    _delete_vectors(page_id)
    with SessionLocal() as s:
        meta = s.get(KbMeta, page_id)
        if meta:
            s.delete(meta)
            s.commit()
    return {"status": "deleted", "page_id": page_id}


# --------------------------------------------------------------------------
# Settings (Phase 10.1)
#   /api/settings            user prefs (GET/PUT)
#   /api/admin/settings      RAG-tuning overrides (admin only, GET/PUT/DELETE)
#   /api/integrations/status integration status grid (read-only; never secrets)
# --------------------------------------------------------------------------


def _serialize_user_settings(s: UserSettings) -> dict:
    return {
        "username": s.username,
        "theme": s.theme,
        "density": s.density,
        "chat_font_size": s.chat_font_size,
        "code_font": s.code_font,
        "show_token_usage": s.show_token_usage,
        "show_rag_sources": s.show_rag_sources,
        "stream_responses": s.stream_responses,
        "markdown_rendering": s.markdown_rendering,
        "auto_escalate_on_caution": s.auto_escalate_on_caution,
        "history_retention_days": s.history_retention_days,
        "escalate_include_transcript": s.escalate_include_transcript,
        "escalate_include_sources": s.escalate_include_sources,
        "escalate_open_new_tab": s.escalate_open_new_tab,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


_USER_SETTABLE_FIELDS = {
    "theme", "density", "chat_font_size", "code_font",
    "show_token_usage", "show_rag_sources", "stream_responses",
    "markdown_rendering", "auto_escalate_on_caution",
    "history_retention_days",
    "escalate_include_transcript", "escalate_include_sources",
    "escalate_open_new_tab",
}


@app.get("/api/settings")
def get_my_settings(user: str = Depends(get_current_user)) -> dict:
    """Return the current user's preferences (creating the row on first read)."""
    from app.persistence.database import SessionLocal

    s = SessionLocal()
    try:
        row = s.get(UserSettings, user)
        if row is None:
            row = UserSettings(username=user)
            s.add(row)
            s.commit()
            s.refresh(row)
        return _serialize_user_settings(row)
    finally:
        s.close()


@app.put("/api/settings")
def update_my_settings(payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Merge-update the current user's preferences. Unknown fields are ignored."""
    from app.persistence.database import SessionLocal

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be a JSON object")
    s = SessionLocal()
    try:
        row = s.get(UserSettings, user)
        if row is None:
            row = UserSettings(username=user)
            s.add(row)
        for k, v in payload.items():
            if k in _USER_SETTABLE_FIELDS and v is not None:
                setattr(row, k, v)
        s.commit()
        s.refresh(row)
        return _serialize_user_settings(row)
    finally:
        s.close()


@app.get("/api/admin/settings")
def get_admin_settings(user: str = Depends(get_current_user),
                       role: str = Depends(require_role("admin"))) -> dict:
    """RAG-tuning overrides (admin only). Returns metadata for the UI."""
    from app.runtime import metadata as runtime_metadata
    return {"knobs": runtime_metadata()}


@app.put("/api/admin/settings")
def update_admin_settings(payload: dict, user: str = Depends(get_current_user),
                          role: str = Depends(require_role("admin"))) -> dict:
    """Apply one or more RAG-tuning overrides. Takes effect on the next request."""
    from app.runtime import metadata as runtime_metadata
    from app.runtime import set_ as runtime_set

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


@app.delete("/api/admin/settings/{key}")
def reset_admin_setting(key: str, user: str = Depends(get_current_user),
                        role: str = Depends(require_role("admin"))) -> dict:
    """Reset a RAG-tuning override back to the env default."""
    from app.runtime import reset as runtime_reset
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


@app.get("/api/integrations/status")
def integrations_status(user: str = Depends(get_current_user)) -> dict:
    """Integration status grid for the Settings panel — values never exposed."""
    from app.config import SETTINGS as S
    from app.runtime import metadata as runtime_metadata
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

# --------------------------------------------------------------------------
# Eval harness (admin-only) — scores RAG retrieval + LLM answer quality
#   /api/eval/run   POST  — runs the qa_set.yaml against the live pipeline
# --------------------------------------------------------------------------
from app.eval import run_eval as _run_eval


@app.post("/api/eval/run")
async def eval_run_endpoint(user: str = Depends(get_current_user),
                              role: str = Depends(require_role("admin"))) -> dict:
    """Run the eval harness — admin-only."""
    return await _run_eval()


@app.get("/api/eval")
def eval_cases_endpoint(user: str = Depends(get_current_user)) -> dict:
    """Return the eval dataset (no scoring, just questions + expectations)."""
    from app.eval import load_cases
    cases = load_cases()
    return {"n_cases": len(cases),
            "cases": [{"question": c.question, "domain": c.expected_domain,
                       "must_contain": c.answer_must_contain,
                       "expected_sources": c.expected_source_page_ids} for c in cases]}

