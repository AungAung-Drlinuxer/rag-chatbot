import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bot,
  Database,
  Globe,
  HelpCircle,
  Layers,
  Network,
  Server,
  Shield,
} from "lucide-react";

const DOMAIN_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  database: { icon: Database, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/40" },
  network: { icon: Network, color: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-950/40" },
  security: { icon: Shield, color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/40" },
  server: { icon: Server, color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-950/40" },
  kubernetes: { icon: Layers, color: "text-sky-600", bg: "bg-sky-50 dark:bg-sky-950/40" },
  help_desk: { icon: HelpCircle, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/40" },
  general: { icon: Globe, color: "text-slate-600", bg: "bg-slate-100 dark:bg-slate-800" },
};

const SUGGESTIONS = [
  {
    key: "database",
    title: "Database Performance & Locks",
    desc: "PostgreSQL, Oracle, deadlocks & slow queries",
    question: "How do I diagnose and resolve PostgreSQL connection timeouts and lock issues?",
  },
  {
    key: "network",
    title: "VPN & Remote Access",
    desc: "VPN gateway, Wi-Fi, DNS & firewall troubleshooting",
    question: "What are the standard troubleshooting steps for VPN connection failures?",
  },
  {
    key: "security",
    title: "Account & Password Reset",
    desc: "Active Directory, MFA token reset & unlock account",
    question: "How do I reset my password and re-sync my MFA token?",
  },
  {
    key: "kubernetes",
    title: "Kubernetes & Cloud Workloads",
    desc: "CrashLoopBackOff, pod restarts & ingress routing",
    question: "How do I troubleshoot pods stuck in CrashLoopBackOff?",
  },
];

export function EmptyChat({ onSuggestion }: { onSuggestion: (question: string) => void }) {
  const [domains, setDomains] = useState<Array<{ domain: string; display_name?: string }>>([]);

  useEffect(() => {
    import("@/features/domains/api")
      .then(({ getClassifierDomains }) => getClassifierDomains())
      .then((res) => {
        if (Array.isArray(res?.domains) && res.domains.length > 0) {
          setDomains(
            res.domains.map((d: any) => ({
              domain: d.domain_key,
              display_name: d.display_name,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  const chipFor = (key: string) => DOMAIN_ICONS[key] ?? DOMAIN_ICONS.general;

  return (
    <div className="mx-auto w-full max-w-2xl py-4 sm:py-8">
      {/* ============ GREETING HEADER (Clean, modern, Perplexity/ChatGPT style) ============ */}
      <div className="mb-6 text-center sm:mb-8">
        <div className="mx-auto mb-3.5 grid size-12 place-items-center rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-600/20">
          <Bot className="size-6" strokeWidth={2} />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
          How can I help you today?
        </h1>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
          Ask any IT question. Answers are grounded in internal Confluence KB, Jira runbooks, and system docs.
        </p>
      </div>

      {/* ============ QUICK DOMAIN CHIPS (Minimal horizontal pill list) ============ */}
      {domains.length > 0 && (
        <div className="mb-6">
          <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
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
                        `I have a ${d.display_name || d.domain} question.`
                    )
                  }
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-3 text-[11px] font-medium text-slate-600 transition hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-blue-950/40"
                >
                  <Icon className={`size-3 ${meta.color}`} />
                  {d.display_name || d.domain}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => { window.location.hash = "#/articles"; }}
              className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-semibold text-blue-600 transition hover:text-blue-700 dark:text-blue-400"
            >
              All domains
              <ArrowRight className="size-3" />
            </button>
          </div>
        </div>
      )}

      {/* ============ PROMPT SUGGESTION CARDS (Clean, compact 2x2 grid) ============ */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => {
          const meta = chipFor(s.key);
          const Icon = meta.icon;
          return (
            <button
              key={s.title}
              type="button"
              onClick={() => onSuggestion(s.question)}
              className="group flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 text-left transition hover:border-blue-300 hover:bg-slate-50/60 hover:shadow-xs dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/60"
            >
              <div className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${meta.bg}`}>
                <Icon className={`size-3.5 ${meta.color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold text-slate-800 group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400">
                    {s.title}
                  </span>
                  <ArrowRight className="size-3 shrink-0 text-slate-300 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100 dark:text-slate-600" />
                </div>
                <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {s.desc}
                </p>
              </div>
            </button>
          );
        })}
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
