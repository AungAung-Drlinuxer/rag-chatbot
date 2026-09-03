# ragchatbot/backend — deployment notes (copied from it-help-chatbot @ v0.22.00, 2026-09-02)

## What is here
Full backend application source, copied from `C:\Users\aungaung\it-help-chatbot\backend`
(the folder that builds the production image `backend:0.22.00` currently running in K8s).

Excluded on purpose (safe to regenerate):
- `.venv/`            → 1.1 GB virtualenv. Recreate with `uv sync` (lockfile `uv.lock` included).
- `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.ruff_cache/`

## Run locally (dev)
1. `uv sync`                      (creates .venv from uv.lock — exact dependency set)
2. `copy .env.example .env`       (then fill real values — NEVER commit .env)
3. `uv run uvicorn app.main:app --reload --port 8000`

## Production (how the live image is built)
`docker build --no-cache -t harbor.drlinuxer.com/it-help-chatbot/backend:<ver> -f Dockerfile .`
→ push → `kubectl set image deploy/backend ...` (see infra/k8s manifests in the main repo).

## Key components (v0.22.00)
- `app/main.py`            — FastAPI: chat SSE stream, feedback, approvals, LDAP login gate
- `app/dashboard.py`       — tickets/KB/users/RBAC/audits (+ the require_role-as-user 404 fix)
- `app/graph_rag.py`       — LangGraph HITL (interrupt + Command(resume) + PostgresSaver)
- `app/tools/ticket_tool.py` — status-lookup vs create-intent split
- `app/notifier.py`        — SMTP alert mails (approval/ticket_created/status_change)
- `app/auth/ldap_auth.py`  — AD auth + Pending-registration gate
- `workers/`               — celery workers

## Env vars of note (set in k8s ConfigMap `backend-config`)
LLM_MAX_TOKENS=2048 (was 800 — truncated answers), LANGGRAPH_ENABLED=1,
CONFIDENCE_GATE_THRESHOLD=0.75, RETRIEVAL_TOP_K=5
