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
    # v1.6.22 — per-request LLM provider selection: "auto" (default, OpenRouter
    # with Ollama failover), "cloud" (force primary only), or "local"
    # (force on-prem Ollama). None/"auto" preserves the standard failover chain.
    llm_provider: str | None = None
    # v1.6.55 — WHAT THE ANSWER MAY DRAW ON, separate from which model answers.
    #   "kb"    knowledge base only (documents) — no infrastructure tools
    #   "infra" infrastructure tools required (live cluster state)
    #   None/"auto"  decide per question
    # Claude Desktop / opencode separate "chat" from "MCP tools"; the composer needs
    # the same explicit switch, otherwise a KB answer is indistinguishable from an
    # infrastructure answer and a silent tool failure looks like a KB miss.
    mode: str | None = None
    # WHICH CONNECTORS THIS TURN MAY USE — a narrower question than `mode`.
    #
    # Measured reason it exists: a question names one system and the answer touches two.
    # "Loki က label ဘာတွေရှိလဲ" ran on [grafana, rancher] and "Proxmox VMs list ပြပါ"
    # on [proxmox, rancher], because the Kubernetes paths ask Rancher for a cluster id
    # even when the question is not about Kubernetes. Scoping the conversation removes
    # that second call from the answer AND from the evidence card.
    #
    # Names as the chat's scope picker shows them ("rancher", "proxmox", "grafana",
    # "postgres"). None or [] means every enabled server — the pre-scope behaviour — so
    # an untouched picker cannot silently disable infrastructure answers.
    servers: list[str] | None = None



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


# --- Domain Management Schemas ---
from typing import Any
from pydantic import BaseModel, Field

class DomainCreateRequest(BaseModel):
    domain_key: str = Field(..., min_length=2, max_length=64, description="Unique domain key e.g. 'hr'")
    display_name: str = Field(..., min_length=2, max_length=128, description="Display title e.g. 'Human Resources'")
    description: str | None = Field(None, description="Scope or summary of domain")
    keywords: list[str] = Field(default_factory=list, description="Keywords/phrases for classifier matching")
    jira_project: str | None = Field(None, max_length=32)
    jira_assignee: str | None = Field(None, max_length=64)
    icon: str | None = Field("BookOpen", max_length=32)
    color: str | None = Field("blue", max_length=32)
    custom_icon: str | None = None
    is_active: bool = True

class DomainUpdateRequest(BaseModel):
    display_name: str | None = None
    description: str | None = None
    keywords: list[str] | None = None
    jira_project: str | None = None
    jira_assignee: str | None = None
    icon: str | None = None
    color: str | None = None
    custom_icon: str | None = None
    is_active: bool | None = None
