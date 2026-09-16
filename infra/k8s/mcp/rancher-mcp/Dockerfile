# rancher-mcp — Model Context Protocol server for Rancher multi-cluster access.
#
# Runs the server as a long-lived HTTP service (--port 8080) rather than stdio,
# because the consumer is a SERVER (the chatbot backend in a pod), not a desktop
# client. stdio would mean spawning `npx` per request: no per-user auth, no
# lifecycle, no isolation, secrets in the pod env.
#
# The npm package is a thin JS wrapper that spawns a platform-specific NATIVE Go
# binary. Running the wrapper failed with `node: bad option: --port`, and node
# adds ~180MB for no benefit, so this is a multi-stage build: stage 1 installs the
# package to obtain the binary, stage 2 copies just the binary.
#
# AIR-GAP: everything is fetched at BUILD time on the connected build host, so the
# runtime image needs no registry access and no Node runtime. Same discipline as
# the reranker model bake in the backend Dockerfile.

# ---- stage 1: fetch the native binary --------------------------------------
FROM node:22-slim AS fetch
ARG RANCHER_MCP_VERSION=latest
RUN npm install -g --omit=dev "@futuretea/rancher-mcp-server@${RANCHER_MCP_VERSION}" \
    && npm cache clean --force
RUN set -eux; \
    BIN="$(find /usr/local/lib/node_modules/@futuretea -type f -name 'rancher-mcp-server-linux-*' -executable | head -1)"; \
    test -n "$BIN"; \
    cp "$BIN" /tmp/rancher-mcp-server; \
    chmod 0755 /tmp/rancher-mcp-server; \
    /tmp/rancher-mcp-server --help 2>&1 | head -20

# ---- stage 2: runtime (no node, no npm, no shell tooling) ------------------
FROM debian:bookworm-slim
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=fetch /tmp/rancher-mcp-server /usr/local/bin/rancher-mcp-server

# Fail closed by default, even though the upstream defaults are already safe:
#   read_only             default true  -> create/patch/delete disabled
#   disable_destructive   default false -> deletes disabled explicitly too
#   show_sensitive_data   default false -> Secret data masked with ***
#   enable_container_exec default false
# Pinned explicitly so a future upstream default change cannot silently widen what
# this pod is permitted to do.
ENV RANCHER_MCP_PORT=8080 \
    RANCHER_MCP_READ_ONLY=true \
    RANCHER_MCP_DISABLE_DESTRUCTIVE=true \
    RANCHER_MCP_SHOW_SENSITIVE_DATA=false \
    RANCHER_MCP_ENABLE_CONTAINER_EXEC=false \
    RANCHER_MCP_ENABLE_CONTAINER_FILE_UPLOAD=false \
    RANCHER_MCP_ENABLE_CONTAINER_FILE_DOWNLOAD=false \
    RANCHER_MCP_LOG_LEVEL=5

EXPOSE 8080

# --port switches the server from stdio to HTTP/SSE.
#
# ENTRYPOINT + CMD (not CMD alone): with only a CMD, overriding `args:` in a
# Kubernetes manifest replaces the whole command, so the first flag becomes argv[0]
# and the container dies with `exec: "--port": executable file not found in $PATH`.
# An ENTRYPOINT pins the binary so callers can only supply flags.
ENTRYPOINT ["rancher-mcp-server"]
CMD ["--port", "8080"]
