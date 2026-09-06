/**
 * Global floating chat popup — MASTER spec §24-quality mini assistant.
 *
 * Opened from the NeedHelpCard ("Open Chat"). State lives in this module's
 * React context so the popup + conversation persist across page switches
 * (App-level mount, not per-page).
 *
 * Functionality mirrors the full ChatPage: same /api/chat/stream SSE contract
 * (meta → stage → token → done), sources, confidence, ticket escalation.
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
  Paperclip,
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
};

const Ctx = createContext<FloatingChatCtx>({ open: false, setOpen: () => {}, toggle: () => {} });

export function useFloatingChat() {
  return useContext(Ctx);
}

export function FloatingChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return <Ctx.Provider value={{ open, setOpen, toggle }}>{children}</Ctx.Provider>;
}

/* ---------------- Popup ---------------- */

type Msg = Message & { sources?: Source[]; confidence?: number };

export function FloatingChatPopup() {
  const { open, setOpen } = useFloatingChat();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [stage, setStage] = useState<string | undefined>();
  const [sessionRef] = useState(() => `fc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Persist conversation across page switches automatically — this component is
  // mounted at App level, so state survives route changes. Nothing to do here.

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping, open]);

  const send = useCallback(() => {
    const q = input.trim();
    if (!q || isTyping) return;
    setInput("");
    const userMsg: Msg = { id: `u-${Date.now()}`, role: "user", content: q, timestamp: currentTime() };
    const botId = `b-${Date.now()}`;
    setMessages((p) => [...p, userMsg, { id: botId, role: "assistant", content: "", timestamp: currentTime() }]);
    setIsTyping(true);

    const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));

    runChatStream(q, sessionRef, history, {
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
      setMessages((p) => p.map((m) => (m.id === botId ? { ...m, content: m.content + "\n\n⚠️ Connection error — please try again." } : m)));
      setIsTyping(false);
    });
  }, [input, isTyping, messages, sessionRef]);

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
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={[
                "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-5",
                m.role === "user"
                  ? "rounded-br-md bg-blue-600 text-white"
                  : "rounded-bl-md border border-[var(--border)] bg-white text-[#0F172A] dark:bg-[#111827] dark:text-slate-100",
              ].join(" ")}
            >
              {m.role === "user" ? (
                <p className="whitespace-pre-wrap">{m.content}</p>
              ) : (
                <>
                  <div className="prose prose-xs max-w-none [&_p]:my-1 [&_li]:my-0.5 [&_code]:text-[11px]">
                    <ReactMarkdown>{m.content || "…"}</ReactMarkdown>
                  </div>
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
                      Confidence: <span className={m.confidence >= 85 ? "font-semibold text-emerald-600" : m.confidence >= 70 ? "font-semibold text-amber-600" : "font-semibold text-red-500"}>{m.confidence >= 85 ? "High" : m.confidence >= 70 ? "Medium" : "Low"} ({m.confidence}%)</span>
                    </div>
                  )}
                </>
              )}
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
