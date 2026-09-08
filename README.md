# ragchatbot — IT Help Chatbot (Enterprise RAG Assistant)

A production-grade, on-premise AI Assistant platform featuring **LangGraph RAG orchestration**, **Hybrid Search (PostgreSQL PGVector + in-memory BM25s Okapi)**, **Cross-Encoder Reranking**, **OpenBao Secrets Vault**, and full-stack **LGMT Observability (Loki, Grafana, Prometheus, Tempo via Grafana Alloy)**.

---

## 🌟 Core Architecture & Capabilities

```text
[ Desktop Client / Web (React 18 + Vite + Tailwind) ]
                    │  HTTPS / SSE Streaming
                    ▼
[ NGINX Ingress Controller / MetalLB VIP: 10.10.10.200 ]
                    │
                    ▼
[ FastAPI Backend + LangGraph StateGraph (drlinuxer-prod RKE2) ]
   ├── Classify Domain ──────► Dynamic Keywords & Classifier Domains Engine
   ├── Query Rewrite   ──────► Multi-turn Context Resolution
   ├── Hybrid Retrieval:
   │    ├── Dense Semantic  ──► Ollama (bge-m3:latest, 1024-dim, :11434) + PGVector HNSW
   │    └── Sparse Lexical  ──► BM25s Okapi (< 1.5ms, CPU-only, in-memory inverted index)
   ├── RRF Fusion (k=60)    ──► Reciprocal Rank Fusion of Vector & Lexical candidates
   ├── Cross-Encoder Rerank ──► rerank-svc:8080 (bge-reranker-large deep scoring)
   ├── Confidence Gate      ──► Blended Gate: Score >= 0.75 (Answer) vs < 0.75 (Caution / HITL)
   └── Human-In-The-Loop    ──► Pauses graph; centered admin approval modal; creates Jira (ITHD)
```

---

## 📦 Directory Structure

```text
ragchatbot/
├── backend/                  # FastAPI service, LangGraph RAG, PGVector & Celery workers
│   ├── app/
│   │   ├── api/              # REST & SSE routers (chat, auth, knowledge, tickets, admin, etc.)
│   │   ├── classifier/       # Domain classification engine
│   │   ├── knowledge/        # Confluence / file ingest & chunking pipelines
│   │   ├── llm/              # Primary & fallback client (Ollama llama3.2:1b fallback)
│   │   ├── observability/    # OTel tracing (Tempo) & Prometheus metrics exporter
│   │   ├── orchestration/    # High-level RAG orchestration
│   │   ├── persistence/      # CloudNativePG SQLAlchemy models, Redis Sentinel, OpenBao resolver
│   │   ├── rag/              # Hybrid retrieval: PGVector, in-memory BM25s, reranker
│   │   └── tools/            # Ticket tools & status query heuristics
│   ├── eval/                 # RAG evaluation dataset & goldset test harness
│   ├── workers/              # Celery background tasks & Confluence beat sync
│   └── Dockerfile            # Python 3.12 + uv slim container image
├── desktop/                  # Web SPA & Tauri cross-platform desktop application
│   ├── src/
│   │   ├── app/              # Unified theme engine, session bootstrap
│   │   ├── components/       # Shared UI components (PageSidebar, FloatingChat, CommandPalette)
│   │   └── features/         # Domain-sliced modules (chat, knowledge, tickets, users, settings...)
│   └── Dockerfile            # Multi-stage Node.js 22 build + NGINX static server
├── docs/                     # System architecture SVG/HTML diagram and QA screenshots
└── infra/k8s/                # Kubernetes manifests
    ├── monitoring/           # LGMT stack manifests (KSM, Node Exporter, Grafana Alloy)
    ├── openbao/              # OpenBao 3-node Raft HA Vault manifests
    └── postgres/             # CloudNativePG HA cluster templates
```

---

## 🛡️ Telemetry & Observability (LGMT Stack)

Telemetry data forwards to the central host (`10.10.10.18`):
- **Grafana Web UI:** `http://10.10.10.18:3000`
  - *IT Help Chatbot - Observability & LGMT:* `/d/apjntq/it-help-chatbot-observability-and-lgmt`
  - *IT Help Chatbot - APM & Tracing (RAG Deep Dive):* `/d/az9v2m/it-help-chatbot-apm-and-tracing-rag-deep-dive`
  - *IT Help Chatbot - LLM Observability (4 Pillars):* `/d/at9w8v/0698a8b`
- **Prometheus (Metrics):** `http://10.10.10.18:9090` (Scraped by Grafana Alloy)
- **Loki (Logs):** `http://10.10.10.18:3100` (Pushed by Grafana Alloy DaemonSet)
- **Tempo (Traces):** `http://10.10.10.18:3200` & OTLP `http://10.10.10.18:4318` (Live RAG breakdown)

---

## 🚀 Quick Deployment Guide

### 1. Build and Push Images
```bash
# Build Frontend
cd desktop
docker build -t harbor.drlinuxer.com/ragchatbot/frontend:latest .
docker push harbor.drlinuxer.com/ragchatbot/frontend:latest

# Build Backend
cd ../backend
docker build -t harbor.drlinuxer.com/ragchatbot/backend:latest .
docker push harbor.drlinuxer.com/ragchatbot/backend:latest
```

### 2. Deploy to Kubernetes
```bash
# Deploy Monitoring stack (KSM + Node Exporter + Grafana Alloy)
kubectl apply -k infra/k8s/monitoring/

# Update Workloads
kubectl -n it-help-chatbot set image deploy/frontend frontend=harbor.drlinuxer.com/ragchatbot/frontend:latest
kubectl -n it-help-chatbot set image deploy/backend backend=harbor.drlinuxer.com/ragchatbot/backend:latest
```

---

## 🔐 Credentials & Secrets Hygiene
All actual credentials, secrets, API tokens, and private keys have been completely sanitized and replaced with placeholders (`__REPLACE_WITH_*__`). Ensure real secrets are mounted via OpenBao Vault or sealed Kubernetes Secrets before production execution.
