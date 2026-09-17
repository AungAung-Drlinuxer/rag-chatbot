/**
 * SessionPanel — the conversation's "what produced these answers" summary, and the
 * same thing reachable on a phone.
 *
 * WHY THIS REPLACED A DESKTOP-ONLY, KB-ONLY PANEL
 * The right-hand panel was `hidden … xl:flex`, so on a phone (where this app is most
 * used) its contents were unreachable — and its heading was "Retrieval information",
 * which describes the KB pipeline only. For a live-infrastructure answer every value
 * in it reads 0 or "—", because nothing was retrieved.
 *
 * This renders the summary that matches the answer: retrieval stats when documents
 * answered, and the live evidence (servers, calls, duration, read-only, when) when the
 * estate answered. It is deliberately a summary, not a second panel — the point is
 * fewer surfaces, not more.
 */
import { History, Zap } from "lucide-react";

import { Row } from "@/features/chat/components/chat-parts";

export type SessionSummary = {
  live?: boolean;
  serverLabels?: string[];
  at?: string | null;
  calls?: number;
  totalMs?: number;
  readOnly?: boolean;
  chunks?: number | null;
  cited?: number | null;
  rerankUsed?: boolean | null;
  role?: string | null;
  aclScoped?: boolean | null;
};

function secs(ms?: number): string {
  if (!ms) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function SessionPanel({ summary }: { summary: SessionSummary }) {
  const live = summary.live;

  return (
    <div className="rounded-xl bg-[var(--muted)] p-3">
      <div className="flex items-center gap-2">
        {live ? (
          <Zap className="size-3.5 text-emerald-500" />
        ) : (
          <History className="size-3.5 text-blue-500" />
        )}
        <span className="text-[10px] font-semibold">
          {live ? "Live infrastructure" : "Retrieval information"}
        </span>
      </div>

      <div className="mt-3 space-y-2 text-[10px] text-muted-foreground">
        {live ? (
          <>
            <Row
              label="Source"
              value={summary.serverLabels?.length ? summary.serverLabels.join(" · ") : "MCP"}
            />
            <Row label="Tools called" value={summary.calls != null ? String(summary.calls) : "—"} />
            <Row label="Query time" value={secs(summary.totalMs)} />
            <Row label="Queried at" value={summary.at || "—"} />
            <Row label="Access" value={summary.readOnly ? "Read-only" : "—"} />
            {/* Deliberately no confidence row: a percentage about document matching
                says nothing about a fact read off the cluster. */}
          </>
        ) : (
          <>
            <Row
              label="Chunks retrieved"
              value={summary.chunks != null ? String(summary.chunks) : "—"}
            />
            <Row label="Sources cited" value={summary.cited != null ? String(summary.cited) : "—"} />
            <Row
              label="Search type"
              value={
                summary.rerankUsed === true
                  ? "Hybrid + rerank"
                  : summary.rerankUsed === false
                    ? "Hybrid (rerank skipped)"
                    : "—"
              }
            />
            <Row label="Role scope" value={summary.role || "—"} />
          </>
        )}
      </div>
    </div>
  );
}
