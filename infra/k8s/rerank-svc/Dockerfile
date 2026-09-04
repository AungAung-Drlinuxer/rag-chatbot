# rerank-svc — CPU cross-encoder scoring service (bge-reranker-base baked in).
# Build from the repo root context dir:  docker build -t <reg>/it-help-chatbot/rerank-svc:<ver> rerank-svc/
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS base

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/app"

# 1) Dependencies only (cached layer). CPU torch index is declared in pyproject.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# 2) App code
COPY app.py ./

# 3) Bake the reranker model into the image (same discipline as backend v0.21.54):
#    - download happens ONLINE here, at build time, on the connected build host
#    - runtime is fully offline → safe for the air-gapped cluster
ENV HF_HOME=/opt/hf-cache
ENV OMP_NUM_THREADS=2
ENV MKL_NUM_THREADS=2
RUN HF_HUB_OFFLINE=0 /app/.venv/bin/python -c \
      "from sentence_transformers import CrossEncoder; CrossEncoder('BAAI/bge-reranker-base', device='cpu')" && \
    du -sh /opt/hf-cache
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8080

# single worker on purpose: one CrossEncoder singleton, 2 cores max
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
