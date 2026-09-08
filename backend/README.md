# IT Help Chatbot — Backend (FastAPI + LangGraph + PGVector)

Core AI assistant service implementing LangGraph RAG, hybrid search with BM25s Okapi, and full telemetry integration.

---

## 🚀 Key Modules & Capabilities

- **LangGraph StateGraph:** Multi-stage graph handling classification, query rewriting, hybrid retrieval, confidence gating, tool calling, and human-in-the-loop interruption.
- **Hybrid Retrieval Pipeline:**
  - **Dense Semantic:** Dense embeddings (`bge-m3:latest`, 1024-dim) via Ollama with PostgreSQL HNSW indexing.
  - **Sparse Lexical:** In-memory BM25s Okapi engine (< 1.5ms, CPU-only) with automatic invalidation on article ingest or delete.
  - **RRF & Reranking:** Reciprocal Rank Fusion ($k=60$) blended with Cross-Encoder deep scoring (`rerank-svc:8080`).
- **Fault-Tolerant LLM & Fallback:**
  - Primary provider: Configurable OpenAI/OpenRouter/Anthropic gateway with streaming token usage tracking.
  - Local fallback: Local Ollama on-prem execution with `llama3.2:1b` model.
- **OpenTelemetry & Prometheus Exporter:**
  - Distributed traces exported to Tempo (`:4318`) with granular sub-spans.
  - Standard `/metrics` endpoint scraped by Grafana Alloy for token usage, estimated costs, and feedback ratings.

---

## 🛠️ Verification & Build Commands

```bash
# Compile check
uv run python -m py_compile app/main.py

# Docker Container Build
docker build -t harbor.drlinuxer.com/ragchatbot/backend:latest .
```
