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

export type RagTrace = {
  stages: Record<string, number>;
  totalMs: number;
};

/** S1.1 — real retrieval telemetry from the SSE `meta` event (no hardcoded values). */
export type RetrievalInfo = {
  chunks?: number;
  cited?: number;
  top_k?: number;
  rerank_used?: boolean;
  acl_scoped?: boolean;
  role?: string;
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
  /** v1.6.55 — set when the answer came from a live MCP tool, so the UI can
   *  distinguish a documents answer from an infrastructure answer. */
  toolUsed?: string;
  /** ok | failed | error | not_permitted — why the tool path ended as it did. */
  toolNote?: string;
  latencyMs?: number;
  serverId?: string;  // v0.21.90 — DB row id from the done event (feedback target)
  feedback?: 1 | -1;  // v0.21.90 — recorded rating (button state)
  ragTrace?: RagTrace;
  retrieval?: RetrievalInfo;  // S1.1 — real retrieval stats for the right panel
};

export type Conv = {
  session_id: string;
  title?: string;
  updated_at?: string;
  last_at?: string;  // S1.3 — ISO timestamp of the newest message (date grouping)
  is_pinned?: boolean;
};

export function currentTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function latestSources(messages: Message[]): Source[] {
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const latest = assistantMessages[assistantMessages.length - 1];
  return latest?.sources ?? [];
}

/** S1.1 — retrieval stats of the newest assistant turn that reported them. */
export function latestRetrieval(messages: Message[]): RetrievalInfo | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === "assistant" && m.retrieval) return m.retrieval;
  }
  return null;
}

/** S1.3 — bucket a conversation timestamp for sidebar grouping. */
export function dateBucket(iso?: string): string {
  if (!iso) return "Older";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Older";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  const DAY = 86_400_000;
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - DAY) return "Yesterday";
  if (t >= startOfToday - 7 * DAY) return "Previous 7 days";
  if (t >= startOfToday - 30 * DAY) return "Previous 30 days";
  return "Older";
}

/** S3.12 — human-friendly label from a login/username (never invents a real name). */
export function prettyName(userName?: string): string {
  const raw = (userName ?? "").split("@")[0];
  if (!raw) return "";
  return raw
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
