"""Pydantic request/response models (design doc §6 supporting routes)."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginRequest(StrictModel):
    username: str
    password: str


class ChatRequest(StrictModel):
    message: str
    session_id: str | None = None
    context: list[dict] = []  # chat history turns [{role, content}]
    username: str | None = None
    top_k: int | None = None  # override SETTINGS.retrieval_top_k for this call


class EscalateRequest(StrictModel):
    session_id: str | None = None
    message: str = ""
    domain: str | None = None
    confidence: float | None = None
    transcript: list[dict] = []


class RefreshRequest(StrictModel):
    refresh_token: str


class ArticleDraftRequest(StrictModel):
    topic: str
    domain: str = "general"


class FeedbackRequest(StrictModel):
    message_id: str | None = None
    rating: int  # 1 helpful, -1 not helpful
    comment: str | None = None


class ArticleSearchRequest(StrictModel):
    query: str
    domain: str | None = None
    top_k: int = 5


class ArticleRequest(StrictModel):
    """Create / edit a KB article (Phase 7 admin)."""
    page_id: str
    title: str
    body: str
    domain: str = "general"
    source_url: str | None = None
