# proxmox-mcp — Proxmox VE MCP server, fronted by a stdio->HTTP bridge.
#
# WHY A BRIDGE
# @solomonneas/proxmox-mcp is a STDIO server: it is designed to be spawned by a
# desktop client (`command: npx, args: [-y, @solomonneas/proxmox-mcp]`). A backend
# pod must not spawn a subprocess per request — no per-user auth, no lifecycle, no
# isolation, and the Proxmox token would sit in the caller's environment. supergateway
# wraps it in a long-lived streamable-HTTP endpoint (/mcp) so it becomes an ordinary
# in-cluster service, the same shape as rancher-mcp, and the app's MCP client is
# unchanged.
#
# SAFETY — THREE LAYERS, ALL PINNED HERE
# Proxmox can DESTROY virtual machines, and the Kubernetes cluster this app runs on
# is itself hosted on that Proxmox: a wrong call could take out the platform serving
# the chatbot. So:
#   1. PROXMOX_ENABLE_DESTRUCTIVE is deliberately ABSENT. The package requires
#      `confirm: true` + `destructive: true` + a process-level env opt-in for
#      destructive tools, and fails closed in code before any HTTP call. Not setting
#      the flag means the whole tier is unreachable regardless of what the model asks.
#   2. read_only-style: safe writes still need `confirm: true` from the caller, and
#      the assistant's curated tool list contains none of them.
#   3. the application layer additionally filters mutating tool names before they
#      ever reach the model.
#
# AIR-GAP: package + bridge are installed at BUILD time on the connected build host.
FROM node:22-slim

ARG PROXMOX_MCP_VERSION=0.5.1

RUN npm install -g --omit=dev \
        "@solomonneas/proxmox-mcp@${PROXMOX_MCP_VERSION}" \
        supergateway \
    && npm cache clean --force \
    && which proxmox-mcp supergateway

# Credentials are injected at deploy time from a Secret — never baked. The
# destructive opt-in is intentionally NOT set (see the header).
ENV PROXMOX_TLS_INSECURE=false \
    NODE_ENV=production

EXPOSE 8000

# --stdio names the child server; --outputTransport streamableHttp exposes /mcp,
# which is exactly the framing app/mcp/client.py already speaks.
#
# --outputTransport sse, NOT streamableHttp. MEASURED: supergateway's streamable-HTTP
# mode dies with an unhandled "No connection established for request ID" the moment a
# tools/list is sent, taking the whole Node process with it — in both its stateless and
# stateful variants (stateful additionally crashes on a bare notification). Its SSE mode
# serves the identical sequence (initialize -> notifications/initialized -> tools/list ->
# repeats) and stays up, so SSE is the only bridged transport that actually survives.
# app/mcp/client.py speaks SSE for this server via McpClient.transport = "sse".
#
# --healthEndpoint gives a real probe target. The startup banner claims "Health
# endpoints: (none)", which sent me to a tcpSocket probe; the flag exists and is
# stronger evidence than a socket that merely accepts.
ENTRYPOINT ["supergateway"]
CMD ["--stdio", "proxmox-mcp", "--port", "8000", "--outputTransport", "sse", "--healthEndpoint", "/healthz"]
