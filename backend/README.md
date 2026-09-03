# IT Help Chatbot — Backend (FastAPI + LangChain RAG)

> On-prem enterprise IT-help assistant: secure chat + RAG over enterprise knowledge
> (Confluence / file shares / runbooks) with a confidence gate, Jira escalation,
> LDAP/AD auth, scheduled knowledge sync (Celery + Redis) and LGTM telemetry.

> **Developers:** read [GOVERNANCE.md](GOVERNANCE.md) first — responsibilities matrix,
> architecture principles and dependency rules for where code belongs.

---

## Table of Contents
1. [Overview](#overview)
2. [Features](#features)
3. [Tech Stack](#tech-stack)
4. [Architecture](#architecture)
5. [Directory Structure](#directory-structure)
6. [Setup](#setup)
7. [Run](#run)
8. [Configuration](#configuration)
9. [API Endpoints](#api-endpoints)
10. [LLM Provider](#llm-provider)
11. [Testing](#testing)
12. [Docker](#docker)
13. [Kubernetes Deployment](#kubernetes-deployment)
14. [Security](#security)
15. [Design Notes](#design-notes)
16. [Governance](#governance)

---

## Overview
The backend is a **FastAPI** application that implements an enterprise RAG assistant.
It sits behind an **NGINX Ingress** and exposes a streaming chat API (`SSE`), secure
authentication (LDAP/AD → JWT), role-based/domain-scoped access, an async knowledge
ingestion pipeline (Celery) and a confidence-gated answer flow with Jira escalation.

Knowledge lives in **PostgreSQL + pgvector** (Chroma-free, no external vector DB):
Ollama (CPU) produces **768-dim** embeddings (`nomic-embed-text`). LLM inference is
external (**OpenRouter** via `minimax/minimax-m3:free`, OpenAI-compatible) with a **fault-tolerance
fallback** (primary → local Ollama → dev mock).

## Features
| Area | Feature |
|---|---|
| **Auth** | LDAP/AD authenticate (ldap3) · JWT (python-jose HS256) access+refresh · dev fallback `dev/dev` |
| **RBAC/ACL** | LDAP group → role (admin/agent/user) · `require_role` · domain-scoped access · per-domain Jira routing |
| **Chat** | `/api/chat/stream` SSE (fetch + ReadableStream, JWT Bearer) · domain classification · query rewrite · retrieve · gate · answer |
| **Confidence gate** | `confidence_gate_threshold` (0.75) — low confidence → caution + escalate |
| **RAG** | LangChain + **LCEL** chains (query rewrite → retriever → context → prompt → LLM) · prompt-injection guardrail ("data only, never instructions") |
| **Escalation** | Jira REST create **as the authenticated user** (reporter=username) · per-domain project/assignee · dev mock |
| **Article mgmt** | CRUD `/api/articles` (create/update/delete re-embed) · `/api/articles/sync` |
| **Ingestion** | **Celery** worker + beat (30 min) · **Redis** broker/cache · idempotent + change-detection (`kb_meta` content_hash) |
| **Loaders** | Confluence (API) + file shares / runbooks (txt/md/pdf/docx) |
| **Observability** | OTel → LGTM (**Tempo** traces / **Mimir** metrics — best-effort never raises) · `audit_log` table |
| **Eval** | gold-set `scripts/eval_goldset.py` + gate calibration report |

## Tech Stack
- **Python 3.12** (uv) · **FastAPI** + uvicorn
- **LangChain** (langchain-openai / anthropic, PGVector, Ollama) + **LCEL**
- **SQLAlchemy 2** + **psycopg2** · **PostgreSQL 16 + pgvector** (CNPG HA)
- **Celery** + **Redis** (redis)
- **python-jose** · **ldap3** · **httpx**
- **OpenTelemetry** (otlp-proto-http) + **opentelemetry-instrumentation-fastapi/httpx**

## Architecture
```
Desktop (Tauri) ──HTTPS/JWT/SSE──> NGINX Ingress ──> FastAPI
                                                        │
                                       ┌────────────────┼────────────────┐
                                       ▼                ▼                ▼
                                 Auth/LDAP         RAG Orc         Gate→Jira
                                       (LangChain+LCEL)             (escalate)
                                       │
                 ┌─────────────────────┼─────────────────────┐
                 ▼                     ▼                     ▼
            PostgreSQL+pgvector   Ollama (embed)       H-Chat/openai (LLM)
            (CNPG HA + pooler)     (CPU, 768-dim)      (with fallback)
                 │
            Celery worker + beat ──> Redis (broker/cache)
            Confluence / file-share loaders
```
Two flows:
- **Flow A (sync):** chat request — auth → classify → rewrite → retrieve (pgvector) → context → gate → LLM → SSE.
- **Flow B (async):** ingestion — Confluence/files → Celery → clean → chunk → Ollama embed → pgvector (idempotent, change-detected).

## Directory Structure
Organized per [`GOVERNANCE.md`](GOVERNANCE.md) — each package owns one concern;
route handlers stay thin, business logic lives behind the owning module.
```
backend/
├── app/
│   ├── main.py                # FastAPI entrypoint (lifespan, CORS, router wiring)
│   ├── config.py              # settings re-export (impl in core/config.py)
│   ├── schemas.py             # shared API request/response models
│   ├── api/                   # HTTP interface layer (routers only)
│   │   ├── auth.py            # /api/auth — login, refresh, me
│   │   ├── chat.py            # /api/chat/stream (SSE) + conversations
│   │   ├── tickets.py         # /api/escalate, /api/escalations, /api/feedback
│   │   ├── knowledge.py       # /api/articles*, /api/sync-status, /api/contacts
│   │   ├── users.py           # /api/settings, /api/admin/settings, integrations/status
│   │   ├── health.py          # /health
│   │   ├── eval.py            # /api/eval, /api/eval/run (admin)
│   │   └── dashboard.py       # admin dashboard router (users/tickets/rbac/kb mgmt)
│   ├── core/                  # shared infrastructure
│   │   ├── config.py          # pydantic-settings (env-driven)
│   │   ├── logging.py         # root logger setup
│   │   ├── security.py        # JWT issue/verify + password hashing
│   │   ├── exceptions.py      # shared HTTP error helpers
│   │   ├── dependencies.py    # FastAPI deps (get_current_user, get_db, caps)
│   │   └── runtime.py         # runtime-tunable overrides (runtime_kv)
│   ├── auth/                  # authentication & authorization
│   │   ├── ldap.py            # LDAP/AD authenticate (dev fallback)
│   │   ├── rbac.py            # roles, capabilities, domain scoping
│   │   ├── service.py         # login/refresh use-cases
│   │   └── schemas.py         # auth models
│   ├── classifier/            # domain classification
│   │   ├── classifier.py      # Stage 1 keyword engine
│   │   ├── models.py          # Classification result model
│   │   └── classifier_domains.yaml  # externalized vocabulary + weights (Rule 5)
│   ├── orchestration/         # workflow control (single pipeline coordinator)
│   │   ├── orchestrator.py    # run_rag: classify→rewrite→retrieve→context→gate
│   │   ├── stages.py          # one function per pipeline stage
│   │   ├── policies.py        # domain fallback, ticket override, source rows
│   │   └── graph.py           # LangGraph RAG (HITL approval, retry loop)
│   ├── rag/                   # information retrieval
│   │   ├── retrieval.py       # hybrid vector+keyword RRF search + build_context
│   │   ├── reranker.py        # cross-encoder (BAAI/bge-reranker-base)
│   │   ├── gate.py            # confidence gate (answer vs caution)
│   │   ├── rewriter.py        # query rewrite (heuristic)
│   │   ├── embeddings.py      # Ollama embedder + PGVector store
│   │   └── models.py          # RetrievalHit typing
│   ├── llm/                   # model generation (provider abstraction)
│   │   ├── __init__.py        # make_chain / stream_answer (H-Chat→Ollama→mock)
│   │   ├── client.py          # chunk streaming + usage extraction
│   │   ├── prompts.py         # system prompt + dev mock tokens
│   │   ├── models.py          # TokenUsage types
│   │   └── providers/hchat.py # LCEL chain builders (anthropic|openai|ollama)
│   ├── knowledge/             # knowledge ingestion
│   │   ├── ingest.py          # sync_all: load→chunk→embed→upsert (idempotent)
│   │   ├── loaders.py         # multi-source aggregation
│   │   ├── chunker.py         # header-aware chunking
│   │   ├── metadata.py        # change-detection hash + domain resolution
│   │   └── sources/confluence.py
│   ├── integrations/          # raw external-system clients
│   │   ├── confluence.py / confluence_write.py / contacts.py / jira.py
│   │   └── notifier.py        # SMTP alerts (best-effort)
│   ├── persistence/           # data storage
│   │   ├── database.py        # SQLAlchemy engine/session, init_db
│   │   ├── models.py          # ORM (ChatSession, JiraTicket, KbMeta, ...)
│   │   ├── redis.py           # standalone | sentinel client
│   │   ├── search.py          # raw SQL over pgvector chunk store (Rule 3)
│   │   └── repositories/      # conversations / documents / tickets / users
│   ├── observability/         # monitoring & audit
│   │   ├── telemetry.py       # OTel tracer setup (best-effort no-op)
│   │   ├── metrics.py         # counters/histograms → Mimir
│   │   └── audit.py           # best-effort audit_log writes
│   └── tools/                 # controlled chatbot tools
│       └── jira.py            # ticket intent detection + RBAC-scoped lookup
├── eval/
│   ├── rag/runner.py          # qa-set eval harness
│   ├── datasets/qa_set.yaml   # gold Q/A set
│   ├── classifiers/           # (reserved) classifier benchmarks
│   └── reports/               # (output) eval reports
├── workers/
│   ├── celery_app.py          # Celery app (broker=Redis, beat 30m)
│   └── confluence_sync.py     # sync_kb task
├── scripts/
│   ├── seed.py                # dev Confluence seed (chunk→embed→pgvector)
│   ├── ingest.py              # one-shot KB sync (ops)
│   └── eval_goldset.py        # offline gold-set eval + gate calibration
├── tests/
│   ├── unit/                  # classifier / rag / orchestration / llm / auth / core
│   ├── integration/           # api / database / integrations (need PG|Ollama)
│   └── e2e/
├── kb_files/                  # sample runbooks (file-share loader)
├── Dockerfile                 # uv slim, non-root, CMD uvicorn app.main:app
├── GOVERNANCE.md              # module ownership, dependency rules, principles
└── pyproject.toml             # uv-managed deps
```

## Setup
```bash
cd backend
uv sync                       # install deps from uv.lock
cp .env.example .env          # then fill in real values (never commit)

# Data stores (docker compose) — isolated ports:
#   postgres  127.0.0.1:55433 (name: it-help-chatbot)
#   redis    127.0.0.1:6380
docker compose -f docker-compose.dev.yml up -d

# Embeddings — CPU Ollama, pull the 768-dim model
ollama pull nomic-embed-text

# Init DB (create tables + vector ext)
uv run python -c "from app.persistence.database import init_db; init_db()"
```

## Run
```bash
# API
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000

# Celery worker + beat (KB sync)
uv run celery -A workers.celery_app worker -l info
uv run celery -A workers.celery_app beat -l info
```
Dev login: `dev / dev` (when `ldap_url` empty). LGTM/LLM empty → telemetry no-op / dev mock.

## Configuration
Env-driven via `app/config.py` (`pydantic-settings`). Key vars:

| Var | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `...@127.0.0.1:55433/assistant` | SQLAlchemy URL (`app:app_pass` dev) |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama (embeddings) |
| `REDIS_URL` | `redis://localhost:6380/0` | Celery broker (results = `/1`) |
| `REDIS_MODE` | `standalone` | `standalone` \| `sentinel` (Redis Operator HA) |
| `REDIS_SENTINELS` / `REDIS_MASTER_NAME` | — | sentinel hosts / master name |
| `H_CHAT_PROVIDER` | `anthropic` | `anthropic` \| `openai` (any OpenAI-compatible base_url, e.g. OpenRouter) |
| `H_CHAT_BASE_URL` / `H_CHAT_API_KEY` / `H_CHAT_MODEL` | — | LLM endpoint / auth / model |
| `LLM_MAX_TOKENS` | `800` | cap (reasoning models need ≥500) |
| `CONFIDENCE_GATE_THRESHOLD` | `0.75` | gate (see EVAL_REPORT — re-tune ~0.6) |
| `LDAP_URL` / `LDAP_*` / `JWT_SECRET` | — | auth (empty → dev fallback) |
| `RBAC_*` / `DEV_ADMIN_USERNAMES` / `ROLE_DOMAINS` / `DOMAIN_JIRA_ROUTING` | — | RBAC/ACL + routing |
| `CONFLUENCE_*` / `JIRA_BASE_URL` / `JIRA_TOKEN` / `JIRA_PROJECT` | — | integrations |
| `CORS_ORIGINS` | tauri+4173+1420 | allowed browser origins |
| `TEMPO_OTLP_URL` / `MIMIR_OTLP_URL` / `LOKI_URL` | — | LGTM (empty → no-op) |

## API Endpoints
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | status + conf threshold |
| POST | `/api/auth/login` | — | LDAP/AD → JWT (dev fallback) |
| GET | `/api/auth/me` | JWT | username + role |
| POST | `/api/chat/stream` | JWT | SSE chat (meta/token/done) |
| POST | `/api/escalate` | JWT | Jira create as user (reporter) |
| POST | `/api/feedback` | JWT | thumbs up/down |
| POST | `/api/articles/search` | JWT | vector search |
| POST | `/api/articles/sync` | admin/agent | trigger KB sync |
| POST/PUT/DELETE | `/api/articles[/{page_id}]` | admin/agent | article CRUD (re-embed) |
| GET | `/api/contacts/{domain}` | JWT | IT lead contact |

## LLM Provider
`make_chain()` builds a LangChain LCEL runnable based on `H_CHAT_PROVIDER`:
- `anthropic` → `ChatAnthropic`
- `openai` → `ChatOpenAI` (any OpenAI-compatible base_url, incl. **OpenRouter** reasoning models)

**Reasoning models** (e.g. `minimax/minimax-m3:free` via OpenRouter) return `reasoning_content` separately — set `LLM_MAX_TOKENS` high (≥500) or the model spends all tokens reasoning and returns empty `content`. On any primary failure `stream_answer` falls back to local Ollama (`fallback_llm_model`) then dev mock — **never raises**.

## Testing
```bash
uv run ruff check app tests workers scripts
uv run pytest -q            # 41 tests (unit — no DB/Ollama needed)
uv run python scripts/eval_goldset.py   # gold-set eval + gate calibration
```

## Docker
```bash
docker build -t harbor.drlinuxer.com/it-help-chatbot/backend:0.1.0 .
docker push harbor.drlinuxer.com/it-help-chatbot/backend:0.1.0
```
Multi-stage not used (venv cross-copy risk) — slim uv base, runs as non-root `uv` user.
Scanned with hadolint (clean) + trivy (base-image CVEs tracked; `ecdsa`/`zlib` known).
Build from current bases (`--pull`) to clear the `fixed`-available CVEs.

## Kubernetes Deployment
See `../infra/k8s/` — `kubectl apply -k infra/k8s/`. The backend runs as the `backend`
Deployment (+ `celery-worker`/`celery-beat`), image
`harbor.drlinuxer.com/it-help-chatbot/backend:0.1.0` (public Harbor project → no
pull-secret). Config from `backend-config` ConfigMap + `backend-secrets` Secret
(kubeseal/Vault — never commit). In-cluster URLs: `http://ollama:11434`,
`redis://redis:6379/0`, `postgres-ha-pooler-rw:5432/assistant`. Scaling: `hpa.yaml`
(API CPU) + `scaledobject.yaml` (KEDA, Celery queue).
**Prereqs:** CNPG operator (postgres-ha), KEDA (scaledobject). See `infra/k8s/README-DEPLOY.md`.

## Security
- **Never commit real secrets** — `.env` gitignored; K8s via `kubeseal`/Vault (`secrets-template.yaml`).
- **CORS** — only configured origins (Tauri/web/dev).
- **RL/SSE** — NGINX Ingress with `proxy_buffering off` + 600s; `X-Accel-Buffering: no`.
- **Prompt-injection guardrail** — retrieved content treated as data-only, never instructions.
- **Outbound policy** — only approved context leaves the on-prem boundary.
- **RBAC/ACL** — domain-scoped retrieval + require_role on admin routes.

## Design Notes
- **Redis standalone, NOT cluster** — Celery broker `/0` + results `/1` (multi-DB) → cluster (DB 0 only) impossible; Sentinel if HA.
- **pgvector** — `vector(768)`; HNSW/IVFFlat indexes; `CAST(:emb AS vector)` for psycopg2.
- **Embeddings CPU-only** (no GPU node) — embeddings scale is the ingest bottleneck; consider batching.
- **Gate calibration** — 0.75 is conservative (recall 0.33 on gold set); see `../docs/EVAL_REPORT.md`.

## Governance
Module ownership, architecture principles and dependency rules are defined in
[GOVERNANCE.md](GOVERNANCE.md). All contributions must follow its responsibilities
matrix and dependency constraints.
