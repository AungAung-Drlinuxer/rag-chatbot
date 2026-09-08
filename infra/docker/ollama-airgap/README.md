# Airgapped Ollama Build & Packaging

This directory contains the Dockerfile to produce a standalone, airgapped Ollama container image with all required AI models pre-baked at build time.

---

## 📦 Pre-baked Models Included

1. **`nomic-embed-text:latest`** (274 MB) — High-performance vector embeddings model (768 dimensions) used for Knowledge Base indexing and semantic search.
2. **`llama3.2:1b`** (1.3 GB) — Lightweight local CPU-friendly LLM used for offline Chat fallback whenever external LLM providers are unreachable.

---

## 🛠️ Build & Push Command

```bash
# Build the image
docker build -t harbor.drlinuxer.com/platform/ollama:0.5.7-models -f infra/docker/ollama-airgap/Dockerfile .

# Push to Harbor registry
docker push harbor.drlinuxer.com/platform/ollama:0.5.7-models
```

---

## 🚀 Air-gapped Verification

To verify that the models run completely offline without internet or external PVC volume:

```bash
docker run --rm -p 11434:11434 harbor.drlinuxer.com/platform/ollama:0.5.7-models
```
