/**
 * Global floating chat popup — MASTER spec §24-quality mini assistant.
 *
 * Opened from the NeedHelpCard ("Open Chat"). State lives in App-level
 * context/mount so the popup + conversation persist across page switches.
 *
 * v0.22 additions (user feedback):
 *  - Connection errors: auto-retry (2x) + manual "Retry" button on failed bubble
 *  - Message actions: copy answer / copy question / edit & resend user query
 *  - Minimize button: collapses to a round bubble; reopen restores conversation
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  Bot,
  Check,
  Copy,
  Minus,
  Pencil,
  Paperclip,
  RefreshCw,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { runChatStream } from "@/features/chat/hooks/useChatStream";
import { currentTime, type Message, type Source } from "@/features/chat/model";
import { uploadAttachment } from "@/features/chat/api";

/* ---------------- Context ---------------- */

type FloatingChatCtx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  minimized: boolean;
  setMinimized: (v: boolean) => void;
};

const Ctx = createContext<FloatingChatCtx>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
  minimized: false,
  setMinimized: () => {},
});

export function useFloatingChat() {
  return useContext(Ctx);
}

export function FloatingChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return (
    <Ctx.Provider value={{ open, setOpen, toggle, minimized, setMinimized }}>
      {children}
    </Ctx.Provider>
  );
}

/* ---------------- Helpers ---------------- */

function CopyButton({ getText, label }: { getText: () => string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
        } catch {
          // clipboard API unavailable (http) — fallback
          const ta = document.createElement("textarea");
          ta.value = getText();
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-black/5 hover:text-foreground group-hover:opacity-100 dark:hover:bg-white/10"
    >
      {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
    </button>
  );
}

type Msg = Message & { sources?: Source[]; confidence?: number; failed?: boolean; retryQuestion?: string };

export function FloatingChatPopup() {
  const { open, setOpen, minimized, setMinimized } = useFloatingChat();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [stage, setStage] = useState<string | undefined>();
  const [sessionRef] = useState(() => `fc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping, minimized]);

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  /* Core stream runner — used by send() and retry(). failed bubbles carry
     the originating question in `retryQuestion`. */
  const runQuestion = useCallback(
    (question: string, opts?: { replaceBotId?: string; attempt?: number }) => {
      const attempt = opts?.attempt ?? 0;
      const botId = opts?.replaceBotId ?? `b-${Date.now()}`;
      if (!opts?.replaceBotId) {
        setMessages((p) => [
          ...p,
          { id: `u-${Date.now()}`, role: "user", content: question, timestamp: currentTime() },
          { id: botId, role: "assistant", content: "", timestamp: currentTime() },
        ]);
      } else {
        // reset the failed bubble for retry
        setMessages((p) =>
          p.map((m) => (m.id === botId ? { ...m, content: "", failed: false } : m)),
        );
      }
      setIsTyping(true);

      const history = messages
        .filter((m) => !m.failed)
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }));

      runChatStream(question, sessionRef, history, {
        onMeta: () => {},
        onStage: (d) => setStage(d),
        onToken: (tok) =>
          setMessages((p) => p.map((m) => (m.id === botId ? { ...m, content: m.content + tok } : m))),
        onApprovalRequest: () => {},
        onDone: (d) => {
          const meta = d ?? {};
          setMessages((p) =>
            p.map((m) =>
              m.id === botId
                ? {
                    ...m,
                    confidence: meta.confidence != null ? Math.round(meta.confidence * 100) : undefined,
                    sources: (meta.hits ?? []).map((h: any) => ({
                      page_id: h.page_id ?? h.chunk_id ?? String(h.title ?? ""),
                      title: h.title ?? "Knowledge source",
                      space: h.domain ?? h.space ?? "",
                      excerpt: h.text ?? h.excerpt ?? "",
                      relevance: h.score != null ? Math.round(h.score * 100) : undefined,
                      url: h.source_url ?? null,
                    })) as Source[],
                  }
                : m,
            ),
          );
          setIsTyping(false);
          setStage(undefined);
        },
      }).catch(() => {
        // Auto-retry up to 2 attempts, then surface a manual Retry button
        if (attempt < 2) {
          setStage("Reconnecting");
          setTimeout(() => runQuestion(question, { replaceBotId: botId, attempt: attempt + 1 }), 1200);
          return;
        }
        setMessages((p) =>
          p.map((m) =>
            m.id === botId
              ? {
                  ...m,
                  failed: true,
                  retryQuestion: question,
                  content: "⚠️ Connection error — the assistant could not be reached.",
                }
              : m,
          ),
        );
        setIsTyping(false);
        setStage(undefined);
      });
    },
    [messages, sessionRef],
  );

  const send = useCallback(() => {
    const q = input.trim();
    if (!q || isTyping) return;
    setInput("");
    runQuestion(q);
  }, [input, isTyping, runQuestion]);

  const retryFailed = useCallback(
    (botMsg: Msg) => {
      if (isTyping) return;
      // find the user question immediately before this failed bubble
      const idx = messages.findIndex((m) => m.id === botMsg.id);
      const q = messages[idx - 1]?.content ?? botMsg.retryQuestion ?? "";
      if (!q) return;
      runQuestion(q, { replaceBotId: botMsg.id });
    },
    [messages, isTyping, runQuestion],
  );

  const startEdit = useCallback((msg: Msg) => {
    setEditingId(msg.id);
    setEditText(msg.content);
  }, []);

  const submitEdit = useCallback(() => {
    const q = editText.trim();
    if (!q || isTyping) return;
    const idx = messages.findIndex((m) => m.id === editingId);
    if (idx === -1) return;
    // drop everything from the edited user message onward, then re-ask
    setMessages((p) => p.slice(0, idx));
    setEditingId(null);
    setEditText("");
    runQuestion(q);
  }, [editText, isTyping, messages, editingId, runQuestion]);

  /* Minimized: round bubble bottom-right, conversation state preserved */
  if (open && minimized) {
    return (
      <button
        aria-label="Reopen chat"
        onClick={() => setMinimized(false)}
        className="fixed bottom-5 right-5 z-50 grid size-14 place-items-center rounded-full bg-blue-600 text-white shadow-2xl shadow-blue-600/40 transition hover:scale-105 hover:bg-blue-700"
      >
        <Bot className="size-6" />
        {messages.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full border-2 border-white bg-emerald-500 text-[10px] font-bold text-white dark:border-[#0B1220]">
            {messages.filter((m) => m.role === "assistant" && !m.failed).length || "•"}
          </span>
        )}
      </button>
    );
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="AI assistant chat"
      className="fixed bottom-5 right-5 z-50 flex h-[520px] w-[380px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[#0B1930] px-4 py-3 dark:bg-[#0B1930]">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30">
          <Bot className="size-5 text-white" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">IT Knowledge Assistant</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] text-slate-400">Online · RBAC protected</span>
          </div>
        </div>
        <button
          aria-label="Minimize chat"
          title="Minimize"
          onClick={() => setMinimized(true)}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <Minus className="size-4" />
        </button>
        <button
          aria-label="Close chat"
          onClick={() => setOpen(false)}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Body */}
      <div ref={bodyRef} className="flex-1 space-y-4 overflow-y-auto bg-[#F7F9FC] p-4 dark:bg-[#0B1220]">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
              <Sparkles className="size-6" />
            </div>
            <h3 className="mt-3 text-sm font-bold text-[#0F172A] dark:text-slate-100">Hi there! 👋</h3>
            <p className="mt-1 max-w-[240px] text-xs leading-5 text-muted-foreground">
              Ask me anything about your IT environment — I&apos;ll search the internal knowledge base.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "group flex justify-end" : "group flex justify-start"}>
            <div className="max-w-[85%]">
              <div
                className={[
                  "rounded-2xl px-3.5 py-2.5 text-xs leading-5",
                  m.role === "user"
                    ? editingId === m.id
                      ? "rounded-br-md border-2 border-blue-400 bg-blue-50 dark:bg-blue-950/40"
                      : "rounded-br-md bg-blue-600 text-white"
                    : m.failed
                      ? "rounded-bl-md border border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
                      : "rounded-bl-md border border-[var(--border)] bg-white text-[#0F172A] dark:bg-[#111827] dark:text-slate-100",
                ].join(" ")}
              >
                {m.role === "user" ? (
                  editingId === m.id ? (
                    <div>
                      <textarea
                        ref={editRef}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                          if (e.key === "Escape") { setEditingId(null); setEditText(""); }
                        }}
                        rows={2}
                        className="w-full resize-none rounded-lg border border-blue-200 bg-white p-2 text-xs text-[#0F172A] outline-none dark:border-blue-800"
                      />
                      <div className="mt-1.5 flex justify-end gap-1.5">
                        <button
                          onClick={() => { setEditingId(null); setEditText(""); }}
                          className="rounded-md px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-black/5 dark:hover:bg-white/10"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={submitEdit}
                          disabled={!editText.trim()}
                          className="rounded-md bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Resend
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )
                ) : (
                  <>
                    <div className="prose prose-xs max-w-none [&_p]:my-1 [&_li]:my-0.5 [&_code]:text-[11px]">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                    {m.failed && (
                      <button
                        onClick={() => retryFailed(m)}
                        disabled={isTyping}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-2.5 py-1.5 text-[10px] font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                      >
                        <RefreshCw className={`size-3 ${isTyping ? "animate-spin" : ""}`} />
                        Retry
                      </button>
                    )}
                    {(m.sources?.length ?? 0) > 0 && (
                      <div className="mt-2 border-t border-[var(--border)] pt-2">
                        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                          <Sparkles className="size-3 text-blue-500" /> Sources
                        </div>
                        {m.sources!.slice(0, 3).map((s, i) => (
                          <div key={i} className="mb-1 truncate rounded-lg bg-[#EFF6FF] px-2 py-1 text-[10px] text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
                            📄 {s.title}
                            {s.relevance != null && <span className="ml-1 text-emerald-600 dark:text-emerald-400">{s.relevance}%</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {m.confidence != null && (
                      <div className="mt-1.5 text-[10px] text-muted-foreground">
                        Confidence:{" "}
                        <span className={m.confidence >= 85 ? "font-semibold text-emerald-600" : m.confidence >= 70 ? "font-semibold text-amber-600" : "font-semibold text-red-500"}>
                          {m.confidence >= 85 ? "High" : m.confidence >= 70 ? "Medium" : "Low"} ({m.confidence}%)
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Message actions (hover) — copy answer / copy question / edit query */}
              <div className={`mt-1 flex items-center gap-1 ${m.role === "user" ? "justify-end" : ""}`}>
                <CopyButton getText={() => m.content} label={m.role === "user" ? "Copy question" : "Copy answer"} />
                {m.role === "user" && editingId !== m.id && (
                  <button
                    type="button"
                    title="Edit & resend"
                    aria-label="Edit and resend this question"
                    onClick={() => startEdit(m)}
                    className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-black/5 hover:text-foreground group-hover:opacity-100 dark:hover:bg-white/10"
                  >
                    <Pencil className="size-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="grid size-7 place-items-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/40">
              <Bot className="size-3.5" />
            </span>
            {stage || "Thinking"}…
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-[var(--border)] bg-white p-3 dark:bg-[#111827]">
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex items-end gap-2 rounded-2xl border border-[#E2E8F0] bg-white p-1.5 transition focus-within:border-blue-400 dark:border-slate-700 dark:bg-[#0B1220]"
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try { await uploadAttachment(f, sessionRef); } catch { /* non-blocking */ }
              e.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label="Attach file"
            onClick={() => fileRef.current?.click()}
            className="rounded-xl p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Paperclip className="size-4" />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask an IT question..."
            className="h-10 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={!input.trim() || isTyping}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-blue-600 text-white shadow-sm shadow-blue-600/25 transition hover:bg-blue-700 disabled:bg-slate-300 disabled:shadow-none dark:disabled:bg-slate-700"
          >
            <ArrowUp className="size-4" />
          </button>
        </form>
        <div className="mt-1.5 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
          <Shield className="size-3" />
          AI answers may require verification · RBAC protected
        </div>
      </div>
    </div>
  );
}
