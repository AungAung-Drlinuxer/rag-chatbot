/**
 * Chat — the support workspace.
 *
 * Every pixel of data here is real: answers arrive over `/api/chat/stream` (meta → stage →
 * token → done), conversations are loaded from the conversations API, sources are the
 * `meta.hits` the retriever actually returned, and the health strip is the same
 * `/api/dashboard/health` probe the Overview uses. Nothing is pre-filled: a new chat is
 * empty and says so, and an answer with no sources shows no source list.
 *
 * Layout is a three-part column that owns its own scrolling:
 *   header (fixed) · transcript (scrolls) · composer (fixed)
 * with the evidence rail only from `xl`, because on a phone the transcript is the product.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  BookOpen,
  CornerDownLeft,
  Database,
  Loader2,
  MessageSquarePlus,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Ticket,
  Wifi,
  X,
} from "lucide-react";

import MessageBubble from "@/features/chat/components/MessageBubble";
import SystemStatus from "@/features/chat/components/SystemStatusPanel";
import { runChatStream } from "@/features/chat/hooks/useChatStream";
import { submitFeedback } from "@/features/chat/api";
import { getConversationMessages } from "@/features/conversations/api";
import { createTicketApi, listActiveDomains } from "@/features/tickets/api";
import { currentTime, latestSources, type Message, type Source } from "@/features/chat/model";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  userName?: string;
  role?: string;
  displayRole?: string;
  perms?: Record<string, boolean>;
  onNavigate?: (nav: string) => void;
  onLogout?: () => void;
};

/* ---------------------------------------------------------------- greeting */

const EXAMPLES: { icon: typeof Database; label: string; question: string; hint: string }[] = [
  {
    icon: Database,
    label: "Database",
    question: "PostgreSQL is refusing connections — what should I check first?",
    hint: "Connection limits, pooling and listener config",
  },
  {
    icon: Wifi,
    label: "Network",
    question: "VPN keeps dropping every 20 minutes — how do I diagnose it?",
    hint: "MTU, rekey timers and gateway logs",
  },
  {
    icon: ShieldCheck,
    label: "Identity",
    question: "A user is stuck in an MFA loop after a password reset.",
    hint: "Token state and directory sync",
  },
  {
    icon: Ticket,
    label: "Escalation",
    question: "Show me how to raise this to the right Jira queue.",
    hint: "Routing rules per domain",
  },
];

function Greeting({ domains, onAsk }: { domains: { key: string; label: string }[]; onAsk: (q: string) => void }) {
  return (
    <section className="mx-auto w-full max-w-3xl pb-2">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--primary)]">
          <Bot className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight sm:text-xl">Grounded IT answers, with the source attached.</h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
            Ask about an incident, a procedure or a system. Every answer is retrieved from your
            knowledge base and cites the pages it used — and can be escalated to Jira in one step.
          </p>
        </div>
      </div>

      {domains.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Coverage</span>
          {domains.slice(0, 8).map((d) => (
            <span key={d.key} className="rounded-md border border-[var(--border)] bg-card px-2 py-0.5 text-2xs text-muted-foreground">
              {d.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {EXAMPLES.map(({ icon: Icon, label, question, hint }) => (
          <button
            key={label}
            type="button"
            onClick={() => onAsk(question)}
            className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-card p-3 text-left transition hover:border-[var(--primary)]/40 hover:bg-[var(--accent-soft)]/40"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--muted)] text-muted-foreground transition group-hover:text-[var(--primary)]">
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
              <span className="mt-1 block text-xs font-medium leading-snug text-foreground">{question}</span>
              <span className="mt-0.5 block text-2xs leading-4 text-muted-foreground">{hint}</span>
            </span>
            <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" aria-hidden />
          </button>
        ))}
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-2xs text-muted-foreground">
        <Sparkles className="size-3" aria-hidden />
        Example questions — edit before sending, or type your own.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- page */

export default function Chat({ onNavigate }: Props) {
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [title, setTitle] = useState("New conversation");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, 1 | -1>>({});
  const [toast, setToast] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [domains, setDomains] = useState<{ key: string; label: string }[]>([]);
  const [ticketFor, setTicketFor] = useState<Message | null>(null);
  const [ticketSummary, setTicketSummary] = useState("");
  const [ticketDesc, setTicketDesc] = useState("");
  const [ticketBusy, setTicketBusy] = useState(false);

  const history = useRef<{ role: string; content: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const startedAt = useRef(0);

  const isStreaming = streamingId !== null;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const scrollToEnd = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    listActiveDomains().then((d) => setDomains(Array.isArray(d) ? d : [])).catch(() => setDomains([]));
  }, []);

  // Auto-grow the composer up to 8 lines, then it scrolls.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, [input]);

  useEffect(() => {
    if (!isStreaming) return;
    const t = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    return () => window.clearInterval(t);
  }, [isStreaming]);

  useEffect(() => {
    scrollToEnd(false);
  }, [messages.length, scrollToEnd]);

  /* ---------------- conversations ---------------- */

  const openConversation = useCallback(async (id: string) => {
    setSessionId(id);
    setLoadingConversation(true);
    setMessages([]);
    try {
      const res: any = await getConversationMessages(id);
      const loaded: Message[] = (res?.messages ?? []).map((m: any, i: number) => ({
        id: m.message_id || `m-${i}`,
        role: m.role,
        content: m.content ?? "",
        timestamp: m.timestamp
          ? new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : currentTime(),
        confidence: m.meta?.confidence != null ? Math.round(m.meta.confidence * 100) : undefined,
        decision: m.meta?.decision,
        sources: m.meta?.hits ?? [],
        usage: m.meta?.usage,
        retrieval: m.meta?.retrieval,
        toolUsed: m.meta?.tool_used,
        evidence: m.meta?.evidence ?? null,
        serverId: m.meta?.server_id,
      }));
      setMessages(loaded);
      history.current = loaded.map((m) => ({ role: m.role, content: m.content }));
      const firstUser = loaded.find((m) => m.role === "user");
      setTitle(firstUser?.content || "Conversation");
      window.setTimeout(() => scrollToEnd(false), 80);
    } catch {
      notify("Could not load this conversation.");
      setTitle("Conversation");
    } finally {
      setLoadingConversation(false);
    }
  }, [notify, scrollToEnd]);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setSessionId(crypto.randomUUID());
    setTitle("New conversation");
    setMessages([]);
    setStreamingId(null);
    setStage("");
    setInput("");
    history.current = [];
    window.setTimeout(() => composerRef.current?.focus(), 30);
  }, []);

  useEffect(() => {
    const onOpen = (e: any) => { if (e?.detail) void openConversation(e.detail); };
    const onNew = () => startNewChat();
    const onAsk = (e: any) => {
      if (typeof e?.detail === "string" && e.detail) {
        setInput(e.detail);
        window.setTimeout(() => composerRef.current?.focus(), 30);
      }
    };
    window.addEventListener("ith:open-conversation", onOpen);
    window.addEventListener("ith:new-chat", onNew);
    window.addEventListener("ith:ask", onAsk);
    return () => {
      window.removeEventListener("ith:open-conversation", onOpen);
      window.removeEventListener("ith:new-chat", onNew);
      window.removeEventListener("ith:ask", onAsk);
    };
  }, [openConversation, startNewChat]);

  /* ---------------- send / stream ---------------- */

  const send = useCallback(async (direct?: string) => {
    const question = (direct ?? input).trim();
    if (!question || streamingId) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      timestamp: currentTime(),
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: currentTime(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    history.current = [...history.current, { role: "user", content: question }];
    setInput("");
    setStage("Understanding the question");
    setElapsed(0);
    startedAt.current = Date.now();
    setStreamingId(assistantId);
    if (messages.length === 0) setTitle(question);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await runChatStream(
        question,
        sessionId,
        history.current.slice(0, -1),
        {
          onMeta: (meta: any) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      confidence: meta.confidence != null ? Math.round(meta.confidence * 100) : undefined,
                      decision: meta.decision,
                      sources: meta.hits ?? [],
                      usage: meta.usage,
                      retrieval: meta.retrieval,
                      toolUsed: meta.tool_used,
                      evidence: meta.evidence ?? null,
                      serverId: meta.server_id,
                      serversScope: meta.servers_scope,
                    }
                  : m,
              ),
            );
          },
          onToken: (token: string) => {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + token } : m)));
          },
          onStage: (detail: string) => setStage(detail),
          onApprovalRequest: () => setStage("Waiting for an approval decision"),
          onCaution: () => setStage("Low confidence — showing a caution notice"),
          onDone: (d: any) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      latencyMs: d?.latency_ms ?? Date.now() - startedAt.current,
                      ragTrace: d?.rag_trace ?? m.ragTrace,
                      serverId: d?.message_id ?? m.serverId,
                    }
                  : m,
              ),
            );
            setStreamingId(null);
            setStage("");
            window.dispatchEvent(new CustomEvent("ith:refresh-conversations"));
          },
        },
        "auto",
        "auto",
        undefined,
        ctrl.signal,
      );
    } catch (err: any) {
      const aborted = err?.name === "AbortError";
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          if (aborted) return { ...m, content: m.content };
          return {
            ...m,
            content: m.content || `The answer could not be generated: ${err?.message ?? "connection error"}.`,
            decision: "error",
          };
        }),
      );
      if (!aborted) notify("The answer stream failed.");
    } finally {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          history.current.push({ role: "assistant", content: m.content });
          return m;
        }),
      );
      setStreamingId(null);
      setStage("");
      abortRef.current = null;
    }
  }, [input, messages.length, notify, sessionId, streamingId]);

  const stop = () => {
    abortRef.current?.abort();
    setStreamingId(null);
    setStage("");
    notify("Generation stopped.");
  };

  const rate = async (m: Message, rating: 1 | -1) => {
    try {
      await submitFeedback(m.serverId ?? m.id, rating);
      setFeedback((prev) => ({ ...prev, [m.id]: rating }));
      notify(rating === 1 ? "Thanks — marked helpful." : "Noted — we will review this answer.");
    } catch {
      notify("Feedback could not be saved.");
    }
  };

  const latest = useMemo<Source[]>(() => latestSources(messages), [messages]);
  const lastAnswer = useMemo(() => [...messages].reverse().find((m) => m.role === "assistant" && m.content), [messages]);

  function openTicket(m: Message) {
    const question = [...messages].slice(0, messages.indexOf(m)).reverse().find((x) => x.role === "user");
    setTicketFor(m);
    setTicketSummary(question?.content.slice(0, 90) || "Incident from the IT assistant");
    setTicketDesc(m.content);
  }

  async function submitTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!ticketSummary.trim()) return;
    setTicketBusy(true);
    try {
      await createTicketApi({
        subject: ticketSummary.trim(),
        description: ticketDesc,
        priority: "medium",
        domain: "general",
        session_id: sessionId,
      });
      setTicketFor(null);
      notify("Ticket created in Jira.");
    } catch (err: any) {
      notify(err?.message || "Ticket creation failed.");
    } finally {
      setTicketBusy(false);
    }
  }

  const citedTitles = useMemo(() => new Set(latest.map((s) => s.title)).size, [latest]);
  const answered = useMemo(() => messages.filter((m) => m.role === "assistant" && m.content).length, [messages]);

  const rail = (
    <div className="space-y-3">
      <section className="rounded-xl border border-[var(--border)] bg-card p-3">
        <h2 className="text-xs font-semibold">This conversation</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-2xs">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Answers</dt>
            <dd className="font-medium tabular-nums">{answered}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Pages cited</dt>
            <dd className="font-medium tabular-nums">{citedTitles}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Passages</dt>
            <dd className="font-medium tabular-nums">{latest.length}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Last</dt>
            <dd className="font-medium tabular-nums">
              {lastAnswer?.latencyMs ? `${(lastAnswer.latencyMs / 1000).toFixed(1)}s` : "—"}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-2xs leading-4 text-muted-foreground">
          Every answer lists the pages it used underneath it.
        </p>
      </section>

      {lastAnswer?.retrieval && (
        <section className="rounded-xl border border-[var(--border)] bg-card p-3">
          <h2 className="text-xs font-semibold">Last retrieval</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-2xs">
            {[
              ["Chunks", lastAnswer.retrieval.chunks],
              ["Cited", lastAnswer.retrieval.cited],
              ["Top-k", lastAnswer.retrieval.top_k],
              ["Reranked", lastAnswer.retrieval.rerank_used == null ? undefined : lastAnswer.retrieval.rerank_used ? "Yes" : "No"],
              ["ACL scoped", lastAnswer.retrieval.acl_scoped == null ? undefined : lastAnswer.retrieval.acl_scoped ? "Yes" : "No"],
              ["Role", lastAnswer.retrieval.role],
            ]
              .filter(([, v]) => v !== undefined && v !== null && v !== "")
              .map(([k, v]) => (
                <div key={String(k)} className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium tabular-nums">{String(v)}</dd>
                </div>
              ))}
          </dl>
        </section>
      )}

      <SystemStatus onNavigate={onNavigate} />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* ---------------- header ---------------- */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--primary)]" aria-hidden>
            <Bot className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-2xs text-muted-foreground">Workspace · Support chat</p>
            <h1 className="truncate text-sm font-semibold leading-tight" title={title}>{title}</h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isStreaming && (
            <span className="hidden items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2 py-1 text-2xs font-medium text-[var(--accent-foreground)] sm:inline-flex">
              <Loader2 className="size-3 animate-spin" aria-hidden /> Answering
            </span>
          )}
          <button
            type="button"
            onClick={startNewChat}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-card px-2.5 text-2xs font-semibold transition hover:bg-muted"
          >
            <MessageSquarePlus className="size-3.5" aria-hidden /> New chat
          </button>
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-card px-2.5 text-2xs font-semibold transition hover:bg-muted xl:hidden"
          >
            <BookOpen className="size-3.5" aria-hidden /> Details
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---------------- transcript + composer ---------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6" aria-live="polite">
            <div className="mx-auto w-full max-w-3xl space-y-5 py-6 sm:py-8">
              {loadingConversation && (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
                  ))}
                </div>
              )}

              {!loadingConversation && messages.length === 0 && (
                <Greeting domains={domains} onAsk={(q) => void send(q)} />
              )}

              {!loadingConversation &&
                messages.map((m) => {
                  const busy = streamingId === m.id;
                  return (
                    <div key={m.id} data-role={m.role}>
                      <MessageBubble
                        message={m}
                        onHelpful={() => void rate(m, 1)}
                        onNotHelpful={() => void rate(m, -1)}
                        onOpenTicketForm={() => openTicket(m)}
                        onRetryQuestion={() => {
                          const q = [...messages].slice(0, messages.indexOf(m)).reverse().find((x) => x.role === "user");
                          if (q) void send(q.content);
                        }}
                        busy={busy}
                        liveStageText={busy ? stage : undefined}
                        liveElapsedMs={busy ? elapsed : undefined}
                      />

                      {feedback[m.id] === 1 && <span className="sr-only">Marked helpful</span>}
                    </div>
                  );
                })}

              <div className="h-2" />
            </div>
          </div>

          {/* ---------------- composer ---------------- */}
          <div className="shrink-0 border-t border-[var(--border)] bg-background/95 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6">
            <form
              onSubmit={(e) => { e.preventDefault(); void send(); }}
              className="mx-auto w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-card p-2 shadow-sm transition focus-within:border-[var(--primary)]/60"
            >
              <label htmlFor="chat-input" className="sr-only">Ask a question</label>
              <textarea
                id="chat-input"
                ref={composerRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Ask about an incident, a procedure or a system…"
                className="max-h-44 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 outline-none placeholder:text-muted-foreground"
              />

              <div className="flex items-center justify-between gap-2 px-1 pt-1">
                <span className="hidden items-center gap-1.5 text-2xs text-muted-foreground sm:inline-flex">
                  <CornerDownLeft className="size-3" aria-hidden /> Enter to send · Shift+Enter for a new line
                </span>
                <span className="text-2xs text-muted-foreground sm:hidden">
                  {input.length > 0 ? `${input.length} characters` : "Grounded in your KB"}
                </span>

                <div className="flex items-center gap-1.5">
                  {input.length > 3200 && (
                    <span className="text-2xs tabular-nums text-[var(--warn)]">{input.length}/4000</span>
                  )}
                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={stop}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-card px-3 text-xs font-semibold transition hover:bg-muted"
                    >
                      <Square className="size-3.5" aria-hidden /> Stop
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!input.trim()}
                      aria-label="Send message"
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3.5 text-xs font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Send className="size-3.5" aria-hidden /> Send
                    </button>
                  )}
                </div>
              </div>
            </form>
            <p className="mx-auto mt-1.5 max-w-3xl text-center text-[10px] text-muted-foreground">
              Answers cite the pages they used. Check anything destructive before acting on it.
            </p>
          </div>
        </div>

        {/* ---------------- evidence rail (xl) ---------------- */}
        <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-[var(--border)] px-3 py-4 xl:block">
          <div className="sticky top-0">{rail}</div>
        </aside>
      </div>

      {/* ---------------- mobile rail ---------------- */}
      {railOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 xl:hidden"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setRailOpen(false); }}
        >
          <div role="dialog" aria-modal="true" aria-label="Conversation details" className="flex h-full w-full max-w-sm flex-col bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-semibold">Conversation details</h2>
              <button type="button" aria-label="Close details" onClick={() => setRailOpen(false)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{rail}</div>
          </div>
        </div>
      )}

      {/* ---------------- escalate ---------------- */}
      <Dialog open={!!ticketFor} onOpenChange={(o) => { if (!o) setTicketFor(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Jira ticket</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitTicket} className="space-y-4">
            <label className="block text-xs font-medium">
              Summary
              <input
                value={ticketSummary}
                onChange={(e) => setTicketSummary(e.target.value)}
                required
                className="mt-1.5 h-9 w-full rounded-lg border border-[var(--border)] bg-background px-3 text-xs outline-none focus:border-[var(--primary)]"
              />
            </label>
            <label className="block text-xs font-medium">
              Description
              <textarea
                value={ticketDesc}
                onChange={(e) => setTicketDesc(e.target.value)}
                rows={6}
                required
                className="mt-1.5 w-full resize-y rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-xs leading-5 outline-none focus:border-[var(--primary)]"
              />
            </label>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <button type="button" onClick={() => setTicketFor(null)} className="h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-medium hover:bg-muted">
                Cancel
              </button>
              <button type="submit" disabled={ticketBusy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
                <Ticket className="size-3.5" aria-hidden />
                {ticketBusy ? "Creating…" : "Create ticket"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-xl bg-foreground px-3.5 py-2 text-2xs font-medium text-background shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
