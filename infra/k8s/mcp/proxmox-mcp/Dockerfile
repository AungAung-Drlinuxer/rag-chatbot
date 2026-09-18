# proxmox-mcp — Proxmox VE MCP server, fronted by our own stdio->HTTP bridge.
#
# WHY A BRIDGE AT ALL
# @solomonneas/proxmox-mcp is a STDIO server: it expects to be spawned by a desktop client
# (`command: npx, args: [-y, @solomonneas/proxmox-mcp]`). A backend pod must not spawn a
# subprocess per request — no lifecycle, no isolation, and the Proxmox token would sit in
# the caller's environment. A dedicated pod owns the child once and exposes HTTP.
#
# WHY NOT supergateway (removed in 1.0.3)
# It was the obvious choice and it does not work with this child. Measured, three ways:
#   --outputTransport sse            only ONE client can ever connect; a second logs
#                                    "Already connected to a transport ... use a separate
#                                    Protocol instance per connection" and the process
#                                    dies. Observed killing the pod (2 restarts).
#   --outputTransport streamableHttp stateless: died on the first request.
#   --outputTransport streamableHttp --stateful: died on the first request. The trace:
#                                      Child -> StreamableHttp: {"result":{...},"id":1}
#                                      Response finished
#                                      Child -> StreamableHttp: {"result":{...},"id":1}
#                                      Error: No connection established for request ID: 1
#                                    It handles one stdout frame twice, then throws.
# The child is not at fault: `proxmox-mcp` writes nothing to stdout or stderr until it is
# asked something (verified with the streams separated).
# So bridge.js does the small, explicit job: pair each response to its pending request id
# and forward it exactly once, dropping unmatched frames instead of throwing.
#
# SAFETY — THREE LAYERS, ALL PINNED HERE
# Proxmox can DESTROY virtual machines, and the Kubernetes cluster this app runs on is
# itself hosted on that Proxmox: a wrong call could take out the platform serving the
# chatbot. So:
#   1. PROXMOX_ENABLE_DESTRUCTIVE is deliberately ABSENT. The package requires
#      `confirm: true` + `destructive: true` + a process-level env opt-in for destructive
#      tools, and fails closed in code before any HTTP call. Not setting the flag means the
#      whole tier is unreachable regardless of what the model asks for.
#   2. safe writes still need `confirm: true` from the caller, and the assistant's curated
#      tool list contains none of them.
#   3. the application layer additionally filters mutating tool names before they reach the
#      model.
#
# AIR-GAP: package + bridge are installed at BUILD time on the connected build host.
FROM node:22-slim

ARG PROXMOX_MCP_VERSION=0.5.1

RUN npm install -g --omit=dev \
        "@solomonneas/proxmox-mcp@${PROXMOX_MCP_VERSION}" \
    && npm cache clean --force \
    && which proxmox-mcp

# Credentials are injected at deploy time from a Secret — never baked. The destructive
# opt-in is intentionally NOT set (see the header).
ENV PROXMOX_TLS_INSECURE=false \
    NODE_ENV=production \
    BRIDGE_PORT=8000

COPY bridge.js /app/bridge.js

EXPOSE 8000

ENTRYPOINT ["node", "/app/bridge.js"]
