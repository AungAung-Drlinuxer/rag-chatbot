// proxmox-mcp bridge: one stdio child, exposed as a clean streamable-HTTP MCP endpoint.
//
// WHY WE WROTE THIS INSTEAD OF USING A BRIDGE PACKAGE
// @solomonneas/proxmox-mcp is stdio-only, so it needs a wrapper to become an in-cluster
// service. Both off-the-shelf options were measured against this exact child and both
// fail, which is why this file exists rather than a flagged npm dependency:
//
//   supergateway 3.4.3 --outputTransport sse
//     Serves exactly ONE client. A second SSE connection logs
//     "Already connected to a transport. Call close() before connecting to a new
//     transport" and the process dies. Unusable for anything but a single desktop client,
//     and it killed the pod (2 restarts observed).
//
//   supergateway 3.4.3 --outputTransport streamableHttp (stateless AND --stateful)
//     Died on the first request, both variants, with:
//       Child -> StreamableHttp: {"result":{...},"id":1}
//       Response finished
//       Child -> StreamableHttp: {"result":{...},"id":1}   <- the same frame, twice
//       Error: No connection established for request ID: 1
//     i.e. it processes one stdout frame twice and then throws. The child itself is clean:
//     `proxmox-mcp` writes nothing to stdout or stderr until it receives a request.
//
// This bridge does the one thing those packages get wrong here: it pairs a response to the
// single pending request by id and forwards it exactly once. It is deliberately small.
//
// SAFETY: passes its environment through to the child, so PROXMOX_* comes from the Secret.
// PROXMOX_ENABLE_DESTRUCTIVE is never set (see the Deployment), which keeps the package's
// destructive tier unreachable no matter what a caller asks for.

const http = require("http");
const { spawn } = require("child_process");

const PORT = parseInt(process.env.BRIDGE_PORT || "8000", 10);
const CHILD = process.env.BRIDGE_CHILD || "proxmox-mcp";
const TIMEOUT_MS = parseInt(process.env.BRIDGE_TIMEOUT_MS || "30000", 10);

// ---- the stdio child ------------------------------------------------------
let child = null;
let buf = "";
const pending = new Map(); // id -> {resolve, timer}
let seq = 0;

function startChild() {
  child = spawn(CHILD, [], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        console.error("[bridge] non-JSON from child:", line.slice(0, 200));
        continue;
      }
      // A notification has no id and belongs to nobody: drop it, never throw.
      if (msg.id === undefined || msg.id === null) continue;
      const waiter = pending.get(msg.id);
      if (!waiter) {
        // Late or duplicated frame for an id we already answered. Log and drop — this is
        // exactly the case that kills supergateway.
        console.error("[bridge] unmatched response id", msg.id, "(dropped)");
        continue;
      }
      pending.delete(msg.id);
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
    }
  });
  child.stderr.on("data", (d) => {
    const s = d.toString().trim();
    if (s) console.error("[child]", s.slice(0, 400));
  });
  child.on("exit", (code, sig) => {
    console.error(`[bridge] child exited code=${code} sig=${sig}; restarting`);
    for (const [, w] of pending) {
      clearTimeout(w.timer);
      w.resolve({ jsonrpc: "2.0", error: { code: -32000, message: "child restarted" } });
    }
    pending.clear();
    buf = "";
    setTimeout(startChild, 500);
  });
}

function send(body) {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      return resolve({ jsonrpc: "2.0", error: { code: -32000, message: "no child" } });
    }
    const id = body.id;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ jsonrpc: "2.0", id, error: { code: -32000, message: "timeout" } });
    }, TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    child.stdin.write(JSON.stringify(body) + "\n");
  });
}

// ---- HTTP surface ---------------------------------------------------------
// Streamable HTTP, single POST endpoint, JSON response. No SSE, no session id: this server
// is stateless from the caller's point of view, which is what app/mcp/client.py's "http"
// transport speaks. A bare notification returns 202 with an empty body.
const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }
  if (req.method === "GET" && (req.url === "/" || req.url === "/mcp")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ name: "proxmox-mcp-bridge", transport: "streamableHttp", path: "/mcp" }));
  }
  if (req.method !== "POST" || !req.url.startsWith("/mcp")) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not found");
  }

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "parse error" }, id: null }));
    }

    const batch = Array.isArray(body);
    const items = batch ? body : [body];

    // Notifications only: acknowledge without waiting for a reply.
    if (items.every((m) => m.id === undefined || m.id === null)) {
      for (const m of items) child.stdin.write(JSON.stringify(m) + "\n");
      res.writeHead(202, { "content-type": "application/json" });
      return res.end();
    }

    const replies = [];
    for (const m of items) {
      if (m.id === undefined || m.id === null) {
        child.stdin.write(JSON.stringify(m) + "\n");
        continue;
      }
      replies.push(await send(m));
    }
    const payload = batch ? replies : replies[0];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
});

startChild();
server.listen(PORT, "0.0.0.0", () => console.log(`[bridge] listening on ${PORT}, child=${CHILD}`));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    if (child) child.kill();
    server.close(() => process.exit(0));
  });
}
