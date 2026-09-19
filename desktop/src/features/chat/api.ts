/** Chat feature API — SSE stream, feedback, escalation (mirrors /api/chat, /api/feedback, /api/escalate). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export async function streamChat(
  message: string,
  sessionId: string,
  history: { role: string; content: string }[],
  onEvent: (e: { event: string; data: any }) => void,
  llmProvider?: "auto" | "cloud" | "local",
  /** v1.6.55 — "auto" | "kb" | "infra": what the answer may draw on. */
  mode?: "auto" | "kb" | "infra",
  /** Which connectors this turn may use. EMPTY/undefined = every enabled server. */
  servers?: string[],
  signal?: AbortSignal
) {
  const res = await apiFetch(`${BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      message, session_id: sessionId, context: history,
      llm_provider: llmProvider ?? "auto",
      // v1.6.55 — omitted entirely when "auto" so the server default applies.
      mode: mode && mode !== "auto" ? mode : undefined,
      // Omitted when empty: the server treats [] and undefined identically, and leaving
      // the key out keeps an unscoped conversation byte-identical to what it was before
      // scoping existed — which is what makes this change safe to ship with no flag.
      servers: servers && servers.length ? servers : undefined,
    }),
    signal,
  });
  if (res.status === 401) throw new Error("Session expired — please log in again");
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) onEvent({ event, data: JSON.parse(data) });
    }
  }
}

export async function escalate(body: any) {
  const r = await apiFetch(`${BASE}/api/escalate`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
  });
  return r.json();
}

export async function getContact(domain: string) {
  const r = await apiFetch(`${BASE}/api/contacts/${domain}`, { headers: authHeaders() });
  return r.json();
}

export async function listEscalations() {
  const r = await apiFetch(`${BASE}/api/escalations`, { headers: authHeaders() });
  return r.json();
}

export async function submitFeedback(message_id: string | null, rating: number, comment?: string) {
  const r = await apiFetch(`${BASE}/api/feedback`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ message_id, rating, comment }),
  });
  return r.json();
}

export async function uploadAttachment(file: File, sessionId: string): Promise<{ id: string; filename: string; mime: string; size: number }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("session_id", sessionId);
  const r = await apiFetch(`${BASE}/api/attachments`, { method: "POST", body: fd, headers: { ...authHeaders() } });
  if (!r.ok) {
    let msg = `upload failed (HTTP ${r.status})`;
    try { const j = await r.json(); if (j?.detail) msg = String(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}

// --- admin approval queue (HITL) — absolute BASE like every other call; the old
// relative "/api/approvals" depended on a dev proxy and breaks outside it ---
export async function listApprovals(): Promise<{ approvals: any[] }> {
  const r = await apiFetch(`${BASE}/api/approvals`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// v1.6.40 — "cancelled" lets the requester supersede their own escalation with a
// direct ticket-form submission (no graph resume, so no duplicate ticket).
export async function decideApproval(
  id: string,
  decision: "approved" | "rejected" | "cancelled",
) {
  const r = await apiFetch(`${BASE}/api/approvals/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  return r.json().catch(() => ({}));
}

/** The connectors a conversation can be scoped to (chat header picker).
 *
 * Returns an empty list for a role that cannot use infrastructure tools, and on any failure:
 * the picker then hides itself and the chat behaves exactly as it did before scoping existed.
 * An empty list is NEVER treated as "no servers" — see streamChat.
 */
export async function getMcpServers(): Promise<{ servers: { name: string; label: string; curated: boolean }[] }> {
  try {
    const r = await apiFetch(`${BASE}/api/mcp/servers`, { headers: authHeaders() });
    if (!r.ok) return { servers: [] };
    const j = await r.json();
    return { servers: Array.isArray(j?.servers) ? j.servers : [] };
  } catch {
    return { servers: [] };
  }
}

/** Persist a conversation-level setting (currently only the connector scope).
 *
 * PATCHes `/api/conversations/{id}` — the same endpoint the sidebar uses to rename and
 * pin, so the ownership check and the 404 semantics are already in place.
 */
export async function patchConversation(sessionId: string, body: Record<string, unknown>) {
  const r = await apiFetch(`${BASE}/api/conversations/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`patch conversation failed: ${r.status}`);
  return r.json();
}
