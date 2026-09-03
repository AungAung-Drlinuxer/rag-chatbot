/** Chat presentational components — extracted verbatim from Chat.tsx (Step 3). */
import { useEffect, useState } from "react";
import {
  BookOpen,
  Bot,
  Sparkles,
  Ticket as TicketIcon,
  Zap,
  Search,
} from "lucide-react";

export function TypingIndicator({ stage }: { stage?: string }) {
  // v0.21.90 — pipeline status: show WHAT the assistant is doing (per-node SSE
  // stages from LangGraph) with a stage icon, not just bouncing dots.
  const label = stage?.trim() || "Thinking";
  const iconFor = (s: string) => {
    if (/search|retriev|knowledge/i.test(s)) return <Search className="size-3.5" />;
    if (/confidence|gate|scor/i.test(s)) return <Zap className="size-3.5" />;
    if (/ticket|escalat|approval/i.test(s)) return <TicketIcon className="size-3.5" />;
    if (/context|prepar/i.test(s)) return <BookOpen className="size-3.5" />;
    if (/answer|generat/i.test(s)) return <Sparkles className="size-3.5" />;
    return <Bot className="size-3.5" />;
  };
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="flex gap-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-blue-600 text-white">
        <Bot className="size-4 animate-pulse" />
      </div>
      <div className="rounded-2xl rounded-bl-md border bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
            {iconFor(label)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium">
              {label}
              <span className="text-muted-foreground">…</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="size-1 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.3s]" />
                <span className="size-1 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.15s]" />
                <span className="size-1 animate-bounce rounded-full bg-blue-400" />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">{elapsed}s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EmptyChat({ onSuggestion }: { onSuggestion: (q: string) => void }) {
  const suggestions = [
    { title: "Database issue", question: "PostgreSQL is showing connection timeout errors. What should I check?" },
    { title: "Network issue", question: "My VPN connection is failing. How can I troubleshoot it?" },
    { title: "Security", question: "How do I reset my corporate AD password?" },
    { title: "Kubernetes", question: "A Kubernetes pod is stuck in CrashLoopBackOff. What should I check?" },
  ];
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
        <Sparkles className="size-7" />
      </div>
      <h2 className="mt-5 text-xl font-semibold tracking-tight">How can I help you today?</h2>
      <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">
        Ask an IT question. I'll search the internal knowledge base and provide an answer with
        supporting sources.
      </p>
      <div className="mt-7 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s.title}
            onClick={() => onSuggestion(s.question)}
            className="group rounded-xl border bg-white p-4 text-left transition hover:border-blue-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <span className="text-[11px] font-semibold">{s.title}</span>
            <p className="mt-3 text-[10px] leading-4 text-muted-foreground">{s.question}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className={good ? "font-medium text-emerald-600" : "font-medium text-foreground"}>{value}</span>
    </div>
  );
}
