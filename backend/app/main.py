"""FastAPI application entrypoint — IT Help Chatbot backend.

Wires together: logging, lifespan (DB init + telemetry + reranker preload),
CORS, and the HTTP routers under app/api/. Business flow lives in
app/orchestration; route handlers in app/api/*.py (GOVERNANCE layout).
"""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, chat, dashboard, health, knowledge, tickets, users
from app.api import eval as eval_api
from app.core.config import SETTINGS
from app.core.logging import setup_logging
from app.observability.telemetry import setup_telemetry
from app.persistence.database import init_db

setup_logging()
logger = logging.getLogger("it-help-chatbot")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    setup_telemetry()  # Phase 8 — best-effort (no-op when LGTM endpoints not configured)
    # v0.21.54 — preload the reranker at startup (model is baked into the image,
    # so this is ~5s from local cache). Without it, the first user request pays
    # the load cost and the HPA misreads that CPU burst as traffic.
    try:
        from app.rag.reranker import _get_model

        threading.Thread(target=_get_model, daemon=True).start()
        logger.info("reranker preload started (background)")
    except Exception as exc:
        logger.warning("reranker preload skipped: %s", exc)
    yield


app = FastAPI(title="IT Help Chatbot", version=health.APP_VERSION, lifespan=lifespan)

# CORS — allow the Tauri + web/dev frontend origins (Phase 10)
_origins = [o.strip() for o in SETTINGS.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers (HTTP interface layer → app/api/)
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(tickets.router)
app.include_router(knowledge.router)
app.include_router(users.router)
app.include_router(eval_api.router)
app.include_router(dashboard.router)
