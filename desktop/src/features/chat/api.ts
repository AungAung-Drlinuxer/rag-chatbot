/** Chat feature API — SSE stream, feedback, escalation (mirrors /api/chat, /api/feedback, /api/escalate). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export async function streamChat(
  message: string,
  sessionId: string,
  history: { role: string; content: string }[],
  onEvent: (e: { event: string; data: any }) => void,
  signal?: AbortSignal
) {
  const res = await apiFetch(`${BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ message, session_id: sessionId, context: history }),
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

// --- v1.3.4 Grafana select-flow: question → panel choices → live data ---
export type GrafanaPanelChoice = {
  dashboard_uid: string;
  dashboard_title: string;
  panel_title: string;
  expr: string;
  legend: string;
  score: number;
};

export async function grafanaPanelChoices(question: string): Promise<{ choices: GrafanaPanelChoice[]; guardrail?: { action: string; type: string; message: string } }> {
  const r = await apiFetch(`${BASE}/api/grafana/panels`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ question }),
  });
  if (!r.ok) throw new Error(`panel choices failed (HTTP ${r.status})`);
  return r.json();
}

export async function grafanaPanelData(choice: GrafanaPanelChoice) {
  const r = await apiFetch(`${BASE}/api/grafana/panel-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(choice),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail || `panel data failed (HTTP ${r.status})`);
  }
  return r.json();
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

export async function decideApproval(id: string, decision: "approved" | "rejected") {
  const r = await apiFetch(`${BASE}/api/approvals/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  return r.json().catch(() => ({}));
}
