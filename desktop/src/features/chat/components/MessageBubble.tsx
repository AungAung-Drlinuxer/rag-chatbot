/**
 * MessageBubble — one chat message (v1.6.68, extracted from ChatPage).
 *
 * Extracted because ChatPage.tsx had grown past 1,700 lines with this component
 * accounting for ~410 of them: every UI change meant editing one very large file, and
 * this session produced two syntax errors doing exactly that. It is self-contained
 * (it defines its own copyText), so the move is mechanical.
 */
import { AlertTriangle, Bot, Check, CheckCircle2, Clock3, Copy, ExternalLink, Pencil, RotateCcw, Share2, ShieldAlert, Sparkles, Ticket, User, Zap } from "lucide-react";

import AgentActivity, { stageFromText } from "@/components/AgentActivity";
import EvidenceCard from "@/features/chat/components/EvidenceCard";
import MarkdownMessage from "@/components/MarkdownMessage";
import { ConfidenceBadge } from "@/features/chat/components/MessageParts";
import RagPipelineStatus from "@/features/chat/components/RagPipelineStatus";
import { useState } from "react";

import { type Message } from "@/features/chat/model";

function MessageBubble({
  message,
  onHelpful,
  onNotHelpful,
  onOpenTicketForm,
  onSubmitEdit,
  onRetryQuestion,
  onAskLive,
  busy = false,
  liveStageText,
  liveElapsedMs,
}: {
  message: Message;
  onHelpful: () => void;
  onNotHelpful: () => void;
  onOpenTicketForm: () => void;
  onSubmitEdit?: (messageId: string, newText: string) => void;
  onRetryQuestion?: () => void;
  /** v1.6.65 — re-ask the same question against the live estate (KB answers only). */
  onAskLive?: () => void;
  busy?: boolean;
  /** v1.6.38 — live pipeline stage (detail text) for the animated indicator */
  liveStageText?: string;
  liveElapsedMs?: number;
}) {
  const isUser = message.role === "user";
  const caution = message.decision === "caution";
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API unavailable (http) — fallback
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function shareText(text: string) {
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: "IT Help Chatbot", text }); return; } catch { /* cancelled */ }
    }
    await copyText(text); // share unsupported -> copy as fallback
    setShared(true);
    window.setTimeout(() => setShared(false), 1600);
  }

  return (
    <div className={["group/msg flex gap-3", isUser ? "justify-end" : "justify-start"].join(" ")}>
      {!isUser && (
        <div className="grid size-9 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white shadow-sm">
          <Bot className="size-5" />
        </div>
      )}

      <div className={["min-w-0", isUser ? "max-w-[80%]" : "max-w-[88%]"].join(" ")}>
        <div
          className={[
            "min-w-0 max-w-full overflow-hidden rounded-2xl px-5 py-4 text-xs leading-relaxed",
            isUser
              ? "rounded-br-md bg-blue-600 text-white"
              : "rounded-tl-none border border-slate-200 bg-white text-slate-800 shadow-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100",
          ].join(" ")}
        >
          {isUser ? (
            editing ? (
              /* v1.3.1 — in-place edit (ChatGPT-style): textarea inside the bubble */
              <div className="flex flex-col gap-2">
                <textarea
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (editDraft.trim() && editDraft !== message.content) {
                        onSubmitEdit?.(message.id, editDraft.trim());
                      }
                      setEditing(false);
                    } else if (e.key === "Escape") {
                      setEditing(false);
                      setEditDraft(message.content);
                    }
                  }}
                  rows={Math.min(6, Math.max(2, editDraft.split("\n").length))}
                  className="w-full resize-none rounded-xl bg-white/95 px-3 py-2 text-xs text-slate-900 outline-none placeholder:text-slate-400 dark:bg-slate-900/95 dark:text-slate-100"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditing(false); setEditDraft(message.content); }}
                    className="rounded-lg border border-white/40 px-2.5 py-1 text-[10px] font-medium text-white/80 transition hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!editDraft.trim() || editDraft === message.content}
                    onClick={() => {
                      if (editDraft.trim() && editDraft !== message.content) {
                        onSubmitEdit?.(message.id, editDraft.trim());
                      }
                      setEditing(false);
                    }}
                    className="rounded-lg bg-white px-2.5 py-1 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-50 disabled:opacity-50"
                  >
                    Save &amp; resend
                  </button>
                </div>
              </div>
            ) : (
            <div className="min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {message.content || "..."}
            </div>
            )
          ) : (
            <div className="contents">
              {/* v1.6.55 — provenance. An answer built from a live cluster query is a
                  different claim from one read out of documents, and a FAILED lookup
                  must not look like a knowledge gap. */}
              {message.role === "assistant" && message.toolUsed && (
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                  {message.toolNote === "failed" || message.toolNote === "error" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      ⚠ infrastructure lookup failed — no live data
                    </span>
                  ) : message.toolNote === "not_permitted" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      🔒 requires admin/agent role — answered from the knowledge base
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                      ⚡ live infrastructure · read-only MCP
                    </span>
                  )}
                </div>
              )}
              {message.content ? (
                <MarkdownMessage content={message.content} />
              ) : busy ? (
                /* v1.6.45 — the animated agent indicator, restored after the markdown
                   renderer was extracted into MarkdownMessage. */
                <AgentActivity
                  stage={stageFromText(liveStageText)}
                  detail={liveStageText}
                  elapsedMs={liveElapsedMs}
                />
              ) : (message as any).guardrail ? (
                <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                  <div className="flex flex-col gap-1">
                    <div className="font-medium">Blocked by content security policy ({(message as any).guardrail}).</div>
                    <p className="text-[10px] text-muted-foreground">
                      Your message triggered the input guardrail (v1.1.4). No data was sent to the AI
                      provider. Rephrase your question — if you believe this is an error, contact IT.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 text-muted-foreground">
                  <div className="font-medium text-rose-600">No answer received from the AI provider.</div>
                  <p className="text-[10px]">
                    The pipeline ran (retrieval + generation) but the upstream model returned no
                    content — this is usually a free-tier rate limit or invalid model name. Try
                    again, or change the model in <strong>Settings → Integrations → Models Provider</strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Inline Knowledge Base Sources in answer card */}
          {/* v1.6.65 — act on the mode switch. A documents answer to an
              infrastructure-flavoured question is often not what was wanted; this
              re-asks the SAME question against the live estate in one click instead of
              making the user retype it and change the mode. Shown only when this answer
              did NOT come from the estate. */}
          {!isUser && onAskLive && message.content && message.toolUsed !== "mcp_infra"
            && message.toolNote !== "not_permitted" && (
            <div className="mt-3">
              <button
                type="button"
                onClick={onAskLive}
                title="Ask the same question against the live Kubernetes / Rancher estate (read-only)"
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/60 px-2.5 py-1 text-[10px] font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
              >
                <Zap className="size-3" />
                Ask this in Infrastructure mode
              </button>
            </div>
          )}

          {/* v1.6.65 — the live answer's evidence. A documents answer gets source
              cards; without this a cluster answer had NOTHING to show, so the user had
              to take live state on faith. */}
          {!isUser && message.toolUsed === "mcp_infra" && (
            <EvidenceCard
              evidence={message.evidence}
              calls={message.toolCalls}
              raw={message.rawOutput}
              scope={message.serversScope}
            />
          )}

          {/* v1.6.60 — sources are documents, so they are evidence only for a
              documents answer. A live-infrastructure answer is evidenced by the
              cluster, and listing KB articles under it claims a provenance the answer
              does not have. The backend no longer sends them; this guard means a stale
              conversation or a cached payload cannot reintroduce them either. */}
          {!isUser && message.toolUsed !== "mcp_infra" && (message.sources?.length ?? 0) > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800/80">
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-blue-600 dark:text-blue-400" />
                  Sources &amp; Referenced Documents
                </span>
                <span className="text-[10px] font-normal text-muted-foreground">
                  {message.sources!.length} reference{message.sources!.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {message.sources!.map((s, idx) => {
                  const content = (
                    <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 transition hover:border-blue-300 hover:bg-blue-50/40 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-blue-900 dark:hover:bg-blue-950/30">
                      <div className="grid size-6 shrink-0 place-items-center rounded-lg bg-blue-100 text-[10px] font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                        {idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-slate-900 dark:text-slate-100" title={s.title}>
                          {s.title}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          {s.space && <span className="capitalize">{s.space}</span>}
                          {s.relevance != null && (
                            <>
                              <span>•</span>
                              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                {s.relevance}% match
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {s.url && <ExternalLink className="size-3 shrink-0 text-slate-400 group-hover:text-blue-600" />}
                    </div>
                  );
                  return s.url ? (
                    <a key={`${s.page_id}-${idx}`} href={s.url} target="_blank" rel="noreferrer" className="block text-left">
                      {content}
                    </a>
                  ) : (
                    <div key={`${s.page_id}-${idx}`} className="block text-left">
                      {content}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Persisted RAG Execution Pipeline Trace inside Assistant Message Bubble */}
          {!isUser && message.ragTrace && (
            <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800/80">
              <RagPipelineStatus live={message.toolUsed === "mcp_infra"}
                active={false}
                stage=""
                telemetry={message.ragTrace.stages}
                elapsedMs={message.ragTrace.totalMs}
                defaultOpen={false}
              />
            </div>
          )}
        </div>

        <div
          className={[
            "mt-2 flex flex-wrap items-center gap-2",
            isUser ? "justify-end" : "justify-start",
          ].join(" ")}
        >
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock3 className="size-3" />
            {message.timestamp}
          </span>
          {isUser && (
            // v1.1.2 — always-visible compact icons (hover-only hid them on touch devices):
            // Edit query / Copy query / Retry
            // S3.10 — icons were 14px with a ~21px hit area; 16px icons inside a
            // 30px target meet the minimum comfortable touch/click size.
            <span className="flex items-center gap-0.5">
              <button type="button" title="Edit query — edit in place and resend"
                aria-label="Edit query"
                onClick={() => { setEditDraft(message.content); setEditing(true); }}
                className="grid size-[30px] place-items-center rounded-lg text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <Pencil className="size-4" />
              </button>
              <button type="button" title="Copy query" aria-label="Copy query"
                onClick={() => copyText(message.content)}
                className="grid size-[30px] place-items-center rounded-lg text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
              </button>
              <button type="button" title="Retry — re-run this question" aria-label="Retry question"
                onClick={() => onRetryQuestion?.()}
                className="grid size-[30px] place-items-center rounded-lg text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <RotateCcw className="size-4" />
              </button>
            </span>
          )}
          {!isUser && message.content && !busy && (
            <span className="flex items-center gap-1">
              <button type="button" title="Copy answer" aria-label="Copy answer"
                onClick={() => copyText(message.content)}
                className="inline-flex h-[26px] items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" title="Share answer" aria-label="Share answer"
                onClick={() => shareText(message.content)}
                className="inline-flex h-[26px] items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                {shared ? <Check className="size-3.5 text-emerald-500" /> : <Share2 className="size-3.5" />}
                {shared ? "Shared" : "Share"}
              </button>
            </span>
          )}
          {/* v1.6.65 — no confidence badge for a live-infrastructure answer. The
              percentage measures how well a DOCUMENT matched a query, which says
              nothing about a fact read off the cluster; the EvidenceCard carries the
              honest substitutes (scope, time, read-only). The backend already nulls
              the value — this guard keeps a stale/cached payload from showing it. */}
          {!isUser && message.toolUsed !== "mcp_infra" && message.confidence != null && (
            <ConfidenceBadge confidence={message.confidence} />
          )}
          {!isUser && (message.usage?.input_tokens != null || message.usage?.output_tokens != null) && (
            <span
              className="flex items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]"
              title={message.latencyMs ? `Generated in ${(message.latencyMs / 1000).toFixed(1)}s` : undefined}
            >
              <Zap className="size-3 text-amber-500" />
              {message.usage?.input_tokens ?? 0} in · {message.usage?.output_tokens ?? 0} out
              {(message.usage?.input_tokens || message.usage?.output_tokens) ? ` = ${((message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0)).toLocaleString()} tokens` : ""}
              {message.latencyMs ? <span className="text-slate-400 dark:text-slate-500">· {(message.latencyMs / 1000).toFixed(0)}s</span> : null}
            </span>
          )}
          {!isUser && caution && (
            <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="size-3" />
              caution — verify before proceeding
            </span>
          )}
        </div>

        {!isUser && message.content && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => onHelpful()}
              disabled={busy}
              title={message.serverId ? "Record feedback" : "Answer not saved yet"}
              className={[
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition",
                message.feedback === 1
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              <CheckCircle2 className="size-3.5 text-emerald-500" />
              Helpful{message.feedback === 1 ? " ✓" : ""}
            </button>
            <button
              onClick={() => onNotHelpful()}
              disabled={busy}
              title={message.serverId ? "Record feedback" : "Answer not saved yet"}
              className={[
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition",
                message.feedback === -1
                  ? "border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              <AlertTriangle className="size-3.5 text-amber-500" />
              Not helpful{message.feedback === -1 ? " ✓" : ""}
            </button>
            <button
              onClick={onOpenTicketForm}
              className="flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50/80 px-3.5 py-1.5 text-[11px] font-medium text-orange-700 transition hover:bg-orange-100 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300"
            >
              <Ticket className="size-3.5 text-orange-600 dark:text-orange-400" />
              Create ticket
            </button>
          </div>
        )}
      </div>

      {isUser && (
        <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--secondary)] text-[var(--secondary-foreground)]">
          <User className="size-4" />
        </div>
      )}
    </div>
  );
}

/* ============================================================
   CONFIDENCE / SOURCES
============================================================ */


export default MessageBubble;
