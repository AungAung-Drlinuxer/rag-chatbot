/**
 * EvidenceCard — what a live-infrastructure answer should show INSTEAD of sources.
 *
 * WHY THIS EXISTS
 * A knowledge-base answer is evidenced by its documents, and the UI shows them (title,
 * provider, match %). A live-infrastructure answer has no documents, so once the source
 * list was correctly suppressed there was nothing at all — the user had to take a
 * cluster fact on faith. This renders the evidence that actually exists for such an
 * answer: which tool ran, against which server, how long it took, how much came back
 * and when.
 *
 * It deliberately does NOT show a retrieval confidence percentage. "90% confidence" is
 * a statement about how well a document matched a query; for a fact read off the
 * cluster it is a category error. Scope, time and read-only status are the honest
 * substitutes, which is why the backend nulls `confidence` for these answers and sends
 * an `evidence` block instead.
 */
import { useState } from "react";

export type ToolCall = {
  name: string;
  ms?: number;
  bytes?: number;
  server?: string;
  at?: string;
};

export type Evidence = {
  kind?: string;
  servers?: string[];
  read_only?: boolean;
  at?: string | null;
  calls?: number;
  total_ms?: number;
  total_bytes?: number;
};

const SERVER_LABEL: Record<string, string> = {
  rancher: "Rancher / Kubernetes",
  proxmox: "Proxmox VE",
};

function human(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function EvidenceCard({
  evidence, calls, raw,
}: {
  evidence?: Evidence | null;
  calls?: ToolCall[];
  /** The verbatim answer text, offered for copy/inspection. */
  raw?: string;
}) {
  const [open, setOpen] = useState(false);
  const list = calls ?? [];
  const servers = (evidence?.servers ?? []).map((s) => SERVER_LABEL[s] ?? s);

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-emerald-200/70 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-[11px]">
        <span className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
          <span aria-hidden>⚡</span> Live infrastructure
        </span>
        <span className="text-emerald-700/80 dark:text-emerald-400/80">
          {servers.length ? servers.join(" · ") : "read-only MCP"}
        </span>
        {evidence?.read_only && (
          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300">
            read-only
          </span>
        )}
        {evidence?.at && (
          <span className="text-emerald-700/70 dark:text-emerald-400/70">
            queried {evidence.at}
          </span>
        )}
      </div>

      {list.length > 0 && (
        <div className="border-t border-emerald-200/60 px-3 py-2 dark:border-emerald-900/40">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left text-[10px] font-medium text-emerald-800/90 hover:text-emerald-900 dark:text-emerald-300/90 dark:hover:text-emerald-200"
            aria-expanded={open}
          >
            <span>
              {list.length} {list.length === 1 ? "call" : "calls"}
              {evidence?.total_ms ? ` · ${(evidence.total_ms / 1000).toFixed(1)}s` : ""}
              {evidence?.total_bytes ? ` · ${human(evidence.total_bytes)}` : ""}
            </span>
            <span className="shrink-0 text-emerald-700/70">
              {open ? "Hide ▴" : "Show ▾"}
            </span>
          </button>

          {open && (
            <ul className="mt-2 space-y-1">
              {list.map((c, i) => (
                <li
                  key={`${c.name}-${i}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-white/70 px-2 py-1 font-mono text-[10px] text-slate-600 dark:bg-slate-900/50 dark:text-slate-400"
                >
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {c.name}
                  </span>
                  {c.server && <span className="opacity-70">{c.server}</span>}
                  {c.ms != null && <span>{c.ms} ms</span>}
                  {c.bytes != null && <span>{human(c.bytes)}</span>}
                  {c.at && <span className="opacity-60">{c.at}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {raw && (
        <details className="border-t border-emerald-200/60 px-3 py-2 dark:border-emerald-900/40">
          <summary className="cursor-pointer text-[10px] font-medium text-emerald-800/90 dark:text-emerald-300/90">
            Show full output
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-white/70 p-2 text-[10px] leading-relaxed text-slate-600 dark:bg-slate-900/50 dark:text-slate-400">
            {raw}
          </pre>
        </details>
      )}
    </div>
  );
}
