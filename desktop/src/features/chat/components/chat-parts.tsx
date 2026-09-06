/** Chat presentational components — extracted verbatim from Chat.tsx (Step 3). */
import { useEffect, useState } from "react";
import {
  BookOpen,
  Bot,
  Sparkles,
  Ticket as TicketIcon,
  Zap,
  Search,
  Database,
  Network,
  Lock,
  Server,
  Cloud,
  HardDrive,
  Headphones,
  ArrowRight,
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
    return <Sparkles className="size-3.5" />;
  };
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className="grid size-7 place-items-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
        {iconFor(label)}
      </span>
      <span className="text-xs font-medium">{label}…</span>
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-blue-400"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
    </div>
  );
}

/* =============================================================
    EMPTY CHAT — MASTER spec §5-§11
    Hero panel + domain chips + suggested topic cards.
   ============================================================= */

// Domain accent map — spec §10 (restrained, semantic)
const DOMAIN_ICONS: Record<string, { icon: typeof Database; color: string; bg: string }> = {
  database:   { icon: Database,   color: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950/40" },
  network:    { icon: Network,    color: "text-teal-600",   bg: "bg-teal-50 dark:bg-teal-950/40" },
  security:   { icon: Lock,       color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/40" },
  server:     { icon: Server,     color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-950/40" },
  kubernetes: { icon: Cloud,      color: "text-sky-600",    bg: "bg-sky-50 dark:bg-sky-950/40" },
  storage:    { icon: HardDrive,  color: "text-cyan-600",   bg: "bg-cyan-50 dark:bg-cyan-950/40" },
  help_desk:  { icon: Headphones, color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/40" },
  general:    { icon: BookOpen,   color: "text-slate-600",  bg: "bg-slate-100 dark:bg-slate-800" },
};

const SUGGESTIONS = [
  { key: "database",   title: "Database",  question: "PostgreSQL is showing connection timeout errors. What should I check?", desc: "PostgreSQL, Oracle, SQL, deadlocks, performance tuning and more…" },
  { key: "network",    title: "Network",   question: "My VPN connection is failing. How can I troubleshoot it?", desc: "VPN, Wi-Fi, DNS, firewall, routing issues" },
  { key: "security",   title: "Security",  question: "How do I reset my corporate AD password?", desc: "Password resets, account lockouts, access control" },
  { key: "kubernetes", title: "Kubernetes", question: "A Kubernetes pod is stuck in CrashLoopBackOff. What should I check?", desc: "Pods, deployments, ingress, cluster troubleshooting" },
];

export function EmptyChat({ onSuggestion }: { onSuggestion: (q: string) => void }) {
  const [domains, setDomains] = useState<Array<{ domain: string; display_name?: string }>>([]);

  useEffect(() => {
    // Domain chips from live classifier config (spec §7) — best-effort
    import("@/features/domains/api")
      .then(({ getClassifierDomains }) => getClassifierDomains())
      .then((d) =>
        setDomains(
          (d.domains ?? [])
            .filter((x) => x.is_active !== false)
            .map((x) => ({ domain: x.domain_key, display_name: x.display_name })),
        ),
      )
      .catch(() => setDomains([]));
  }, []);

  const chipFor = (key: string) => DOMAIN_ICONS[key] ?? DOMAIN_ICONS.general;

  return (
    <div className="mx-auto w-full max-w-3xl py-2">
      {/* ============ HERO PANEL (spec §5) ============ */}
      <section className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/80 via-white to-sky-50/60 px-7 py-8 dark:border-blue-950/50 dark:from-blue-950/20 dark:via-[#0B1220] dark:to-sky-950/10 sm:px-9">
        {/* subtle decorative glow (spec: subtle blue gradients, no heavy shadow) */}
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-blue-200/20 blur-3xl dark:bg-blue-800/10" />

        <div className="relative flex items-center gap-5">
          {/* AI illustration (spec §6 — enterprise, not cartoonish) */}
          <div className="hidden shrink-0 sm:block">
            <div className="relative grid size-20 place-items-center rounded-2xl border border-blue-100 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#111827]">
              <div className="absolute inset-0 rounded-2xl bg-blue-400/10 blur-md" aria-hidden />
              <Bot className="relative size-11 text-blue-600 dark:text-blue-400" strokeWidth={1.6} />
              {/* antenna dots */}
              <span aria-hidden className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-white bg-blue-500 dark:border-[#0B1220]" />
            </div>
          </div>

          <div className="min-w-0">
            <h1 className="text-[28px] font-bold leading-tight tracking-tight text-[#0F172A] dark:text-slate-100 lg:text-[30px]">
              How can I help you today?
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500 dark:text-slate-400">
              Ask an IT question. I&apos;ll search the internal knowledge base and provide an
              answer with sources.
            </p>
          </div>
        </div>

        {/* Domain chips (spec §7) */}
        <div className="relative mt-6 flex flex-wrap items-center gap-2">
          {domains.map((d) => {
            const meta = chipFor(d.domain);
            const Icon = meta.icon;
            return (
              <button
                key={d.domain}
                type="button"
                onClick={() =>
                  onSuggestion(
                    SUGGESTIONS.find((s) => s.key === d.domain)?.question ??
                      `I have a ${d.display_name || d.domain} question.`,
                  )
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#D9E4F5] bg-white px-3.5 text-xs font-medium text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-blue-950/40"
              >
                <Icon className={`size-3.5 ${meta.color}`} />
                {d.display_name || d.domain}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => { window.location.hash = "#/articles"; }}
            className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-blue-600 transition hover:text-blue-700 dark:text-blue-400"
          >
            View all domains
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      </section>

      {/* ============ SUGGESTED TOPICS (spec §8-§10) ============ */}
      <section className="mt-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-[#0F172A] dark:text-slate-100">
              <Sparkles className="size-4 text-blue-500" />
              Suggested Topics
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Quick access to common IT questions and troubleshooting guides.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { window.location.hash = "#/articles"; }}
            className="shrink-0 text-xs font-semibold text-blue-600 transition hover:text-blue-700 dark:text-blue-400"
          >
            View all articles →
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => {
            const meta = chipFor(s.key);
            const Icon = meta.icon;
            return (
              <button
                key={s.title}
                type="button"
                onClick={() => onSuggestion(s.question)}
                className="group rounded-2xl border border-[#E2E8F0] bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-[#111827]"
              >
                <div className={`grid size-10 place-items-center rounded-xl ${meta.bg}`}>
                  <Icon className={`size-5 ${meta.color}`} />
                </div>
                <div className="mt-3.5 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-[#0F172A] dark:text-slate-100">{s.title}</span>
                  <ArrowRight className="size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500 dark:text-slate-600" />
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{s.desc}</p>
              </button>
            );
          })}
        </div>
      </section>
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
