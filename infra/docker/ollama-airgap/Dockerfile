FROM ollama/ollama:latest

ENV OLLAMA_HOST=0.0.0.0:11434

# Start ollama server in background, pull both models, then terminate
RUN ollama serve & \
    PID=$! && \
    until ollama list >/dev/null 2>&1; do \
      echo "Waiting for ollama server..." && \
      sleep 2; \
    done && \
    echo "=== Pulling nomic-embed-text for vector embeddings ===" && \
    ollama pull nomic-embed-text && \
    echo "=== Pulling llama3.2:1b for offline LLM fallback ===" && \
    ollama pull llama3.2:1b && \
    echo "=== Pre-baked models verified: ===" && \
    ollama list && \
    kill $PID

EXPOSE 11434
ENTRYPOINT ["ollama", "serve"]
