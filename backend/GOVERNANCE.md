# Backend Governance & Developer Onboarding

This document defines where code belongs, how modules are designed, and which dependencies are allowed. Read this before adding, modifying, or refactoring any backend code.

> **Golden Rule:** API receives requests → Orchestration coordinates → Specialized modules execute → Persistence/Integrations provide data → LLM generates response → API returns result.

---

## 1. Responsibilities Matrix

When adding, modifying, or refactoring code, place logic **only** in the module responsible for that concern.

| Directory | Responsibility | What Belongs Here |
|---|---|---|
| `app/api/` | HTTP Interface | FastAPI route handlers, request/response schemas, parameter validation, authentication decorators |
| `app/orchestration/` | Workflow Control | End-to-end execution flow (Classifier → RAG → LLM), pipeline coordination, execution policies |
| `app/classifier/` | Domain Classification | Domain and technology identification, YAML vocabulary loading, classification engine |
| `app/rag/` | Information Retrieval | Vector search, query rewriting, reranking, retrieval quality checks, embeddings integration |
| `app/llm/` | Model Generation | Prompt construction, model clients, provider abstraction (Ollama, OpenAI, vLLM) |
| `app/knowledge/` | Knowledge Ingestion | Content extraction, loaders, chunking, metadata processing |
| `app/integrations/` | External Systems | Raw clients for Jira, Confluence, LDAP, Kubernetes, and other third-party services |
| `app/persistence/` | Data Storage | PostgreSQL, Redis, repositories, ORM models, database connections |
| `app/auth/` | Authentication & Authorization | LDAP authentication, RBAC, user identity services |
| `app/core/` | Shared Infrastructure | Configuration, logging, security, exceptions, dependency injection |
| `app/observability/` | Monitoring & Audit | Metrics, telemetry, tracing, audit logging |
| `app/tools/` | Controlled Agent Tools | Chatbot-exposed tools such as Kubernetes, Jira, diagnostics |
| `workers/` | Background Processing | Celery workers, async jobs, synchronization tasks |
| `tests/` | Testing | Unit, integration, and end-to-end tests |
| `eval/` | Evaluation Framework | RAG, classifier, and model benchmarking datasets and reports |
| `scripts/` | Operations & Maintenance | Seeding, ingestion utilities, admin and maintenance scripts |

### Module Ownership (quick lookup)

| Concern | Owner |
|---|---|
| Domain vocabulary | YAML Configuration |
| Domain classification | Classifier |
| Workflow execution | Orchestration |
| Context retrieval | RAG |
| Relevance scoring | Reranker |
| Evidence validation | Gate |
| Response generation | LLM |
| Database operations | Persistence |
| External integrations | Integrations |
| Authentication & RBAC | Auth |
| Background processing | Workers |
| Monitoring & auditing | Observability |
| HTTP interfaces | API |

### Target Project Structure

```
backend/
├── app/
│   ├── api/
│   ├── auth/
│   ├── classifier/
│   ├── orchestration/
│   ├── rag/
│   ├── llm/
│   ├── knowledge/
│   ├── integrations/
│   ├── persistence/
│   ├── core/
│   ├── observability/
│   └── tools/
├── workers/
├── tests/
├── eval/
├── scripts/
├── kb_files/
├── Dockerfile
├── pyproject.toml
├── requirements.txt
└── README.md
```

> Note: the codebase follows this structure as of the 2026-09 restructure. If you
> find code in the wrong place, move it to its owning package in the same PR.

### Inside the packages

- `app/api/` is split by domain router (`chat.py`, `auth.py`, `tickets.py`,
  `users.py`, `knowledge.py`, `health.py`, `eval.py`, `dashboard.py`).
  Routers are thin: HTTP in/out only — no business logic, no SQL.
- `app/orchestration/` = `orchestrator.py` (workflow) + `stages.py` (steps) +
  `policies.py` (execution rules) + `graph.py` (LangGraph/HITL).
- `app/persistence/repositories/` holds the query layer the API and other
  modules call instead of touching ORM sessions directly.
- Tests mirror the tree: `tests/unit/<subsystem>/`, `tests/integration/`, `tests/e2e/`.

---

## 2. Architecture & Design Principles

The backend follows a **modular, configuration-driven architecture**. Each module owns a single responsibility and must remain independent from sibling modules.

**Design objectives**

- Clear separation of concerns
- Configuration-driven behavior
- Minimal coupling between modules
- Easy replacement of components
- Scalable and testable architecture

**Practical rules**

- One module = one concern. If logic feels like it belongs to two places, the owner is defined in Section 1.
- Business vocabulary, thresholds, and routing rules live in YAML config — never hardcoded.
- Components must be replaceable: depend on interfaces/clients within the owning module, not on internals of other modules.
- Long-running or scheduled work goes to `workers/`, never request handlers.

---

## 3. Dependency Rules

### Allowed Flow

```
API
 │
 ▼
Orchestration
 │
 ├──► Classifier
 ├──► RAG
 ├──► LLM
 ├──► Auth
 │
 ├──► Persistence
 └──► Integrations
```

### Standard Request Flow

```
API → Orchestration → Classifier → RAG → LLM → Response
```

### Rule 1: Orchestration Owns Workflow

Only `orchestration/` coordinates business workflows.

```
✅ orchestrator.run()
   ├─ classifier.classify()
   ├─ rag.retrieve()
   └─ llm.generate()

❌ rag.retrieve()
   └─ classifier.classify()
```

### Rule 2: No Sibling Dependencies

Subsystems must not directly depend on one another.

| Forbidden | Allowed |
|---|---|
| classifier → rag / llm | orchestration → classifier |
| rag → classifier / orchestration | orchestration → rag |
| llm → rag | orchestration → llm |

### Rule 3: Persistence Is Downstream Only

All database access is isolated in `persistence/`.

```
✅ repository.get_document()
   repository.save_conversation()

❌ classifier.execute_sql(...)
   rag.execute_sql(...)
   llm.execute_sql(...)
```

### Rule 4: Integrations Are Isolated

Jira, Confluence, LDAP, Kubernetes, and all external systems are accessed **only** through `integrations/`.

```
✅ integrations.jira.get_ticket()
   integrations.confluence.search()

❌ classifier.requests.get(...)
   rag.requests.get(...)
```

### Rule 5: Configuration Is Externalized

```yaml
# ✅ domains.yaml
domains:
  kubernetes:
    keywords:
      - kubelet
      - ingress
      - metallb
```

```python
# ❌ never hardcode vocabulary
if "metallb" in question:
    domain = "kubernetes"
```

### Rule 6: Workers Execute Long-Running Tasks

Background workloads belong only in `workers/`:

- Confluence / Jira synchronization
- Embedding generation
- Document chunking
- Scheduled maintenance
