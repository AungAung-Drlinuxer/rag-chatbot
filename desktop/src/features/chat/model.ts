/** Chat feature domain model — message/source types + pure helpers (no React, no fetch). */

export type MsgRole = "user" | "assistant";

export type Source = {
  page_id: string | null;
  title: string;
  space: string;
  relevance: number | null;
  excerpt: string;
  url?: string | null;
};

export type Message = {
  id: string;
  role: MsgRole;
  content: string;
  timestamp: string;
  confidence?: number;
  decision?: string;
  topK?: number;
  sources?: Source[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  latencyMs?: number;
  serverId?: string;  // v0.21.90 — DB row id from the done event (feedback target)
  feedback?: 1 | -1;  // v0.21.90 — recorded rating (button state)
};

export type Conv = { session_id: string; title?: string; updated_at?: string; is_pinned?: boolean };

export function currentTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function latestSources(messages: Message[]): Source[] {
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const latest = assistantMessages[assistantMessages.length - 1];
  return latest?.sources ?? [];
}
