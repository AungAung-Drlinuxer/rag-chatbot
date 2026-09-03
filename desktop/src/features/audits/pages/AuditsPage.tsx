import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Download,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { listAudits } from "@/features/audits/api";
import { PageShell, PageHeader, SectionCard } from "@/components/ui/page";

/**
 * Audits — v0.21.90 (administrator only)
 * Real `audit_log` trail: login / chat / escalate / feedback / sync / approval
 * events with user + action filters and CSV export.
 */

type AuditRow = {
  id: number;
  action: string;
  username: string | null;
  domain: string | null;
  confidence: number | null;
  decision: string | null;
  detail: string | null;
  created_at: string | null;
};

const ACTION_TONES: Record<string, string> = {
  login: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  logout: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  chat: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  escalate: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  feedback: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  sync: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  "approval.decision": "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  approval: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  domain_blocked: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  admin: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
};

function toneFor(action: string): string {
  if (ACTION_TONES[action]) return ACTION_TONES[action];
  for (const k of Object.keys(ACTION_TONES)) {
    if (action.startsWith(k)) return ACTION_TONES[k];
  }
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

function fmt(ts: string | null): string {
  return ts ? ts.slice(0, 19).replace("T", " ") : "—";
}

export default function AuditsPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [limit, setLimit] = useState(100);

  async function load() {
    setLoading(true);
    try {
      const d = await listAudits({ limit, action: filterAction || undefined });
      setRows(d.audits ?? []);
      setTotal(d.total ?? 0);
      setActions(d.actions ?? []);
    } catch (err) {
      console.warn("audits fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [filterAction, limit]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      (r.username ?? "").toLowerCase().includes(needle) ||
      r.action.toLowerCase().includes(needle) ||
      (r.detail ?? "").toLowerCase().includes(needle));
  }, [rows, q]);

  const today = useMemo(() => {
    const d0 = new Date().toISOString().slice(0, 10);
    return rows.filter((r) => (r.created_at ?? "").startsWith(d0)).length;
  }, [rows]);
  const users = useMemo(() => new Set(rows.map((r) => r.username).filter(Boolean)).size, [rows]);

  function exportCsv() {
    const header = "created_at,action,username,domain,decision,confidence,detail";
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = shown.map((r) =>
      [r.created_at, r.action, r.username, r.domain, r.decision, r.confidence,
       (r.detail ?? "").replace(/\r?\n/g, " ")].map(esc).join(","));
    const csv = "\ufeff" + [header, ...lines].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <PageShell>
      <div className="text-[13px]">
        <PageHeader
          icon={<ScrollText className="size-5" />}
          title="Audit Log"
          badge="Administrator"
          description="Every high-value action across the platform — login, chat, escalations, feedback, sync."
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={exportCsv}
                disabled={shown.length === 0}
                className="hidden items-center gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-[11px] font-semibold shadow-sm transition hover:bg-slate-50 disabled:opacity-50 sm:flex dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              >
                <Download className="size-3.5" />
                Export CSV
              </button>
              <button
                onClick={load}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-[11px] font-semibold shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              >
                <RefreshCw className={["size-3.5", loading ? "animate-spin" : ""].join(" ")} />
                Refresh
              </button>
            </div>
          }
        />

        {/* stats */}
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Activity className="size-3.5 text-sky-600" /> Events (fetched)
            </div>
            <div className="mt-1 text-2xl font-bold text-sky-700 dark:text-sky-300">{shown.length}</div>
            <div className="text-[9.5px] text-muted-foreground">of {total} total in log</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="size-3.5 text-cyan-600" /> Today
            </div>
            <div className="mt-1 text-2xl font-bold text-cyan-700 dark:text-cyan-300">{today}</div>
            <div className="text-[9.5px] text-muted-foreground">events in current page</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <UserCheck className="size-3.5 text-teal-600" /> Distinct users
            </div>
            <div className="mt-1 text-2xl font-bold text-teal-700 dark:text-teal-300">{users}</div>
            <div className="text-[9.5px] text-muted-foreground">in current page</div>
          </div>
        </div>

        {/* filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-full max-w-[320px] items-center gap-2 rounded-xl border bg-white px-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search user, action or detail…"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="h-10 rounded-xl border bg-white px-3 text-xs shadow-sm outline-none dark:border-slate-800 dark:bg-slate-900"
          >
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="h-10 rounded-xl border bg-white px-3 text-xs shadow-sm outline-none dark:border-slate-800 dark:bg-slate-900"
          >
            <option value="100">100 rows</option>
            <option value="250">250 rows</option>
            <option value="500">500 rows</option>
          </select>
        </div>

        <SectionCard
          title="Events"
          description="Newest first · stored in the assistant database (audit_log)."
          icon={<ScrollText className="size-4" />}
        >
          <div className="max-h-[560px] overflow-y-auto pr-1">
            <table className="w-full table-fixed text-[11px]">
              <colgroup>
                <col className="w-[15%]" /><col className="w-[13%]" /><col className="w-[14%]" />
                <col className="w-[11%]" /><col className="w-[33%]" /><col className="w-[14%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e2e8f0] dark:bg-slate-900 dark:shadow-[0_1px_0_#1e293b]">
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Time</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Domain</th>
                  <th className="px-4 py-3 font-semibold">Detail</th>
                  <th className="px-4 py-3 text-right font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={"sk" + i}>
                      <td colSpan={6} className="px-4 py-2">
                        <div className="h-4 animate-pulse rounded bg-muted" style={{ width: `${70 + ((i * 13) % 30)}%` }} />
                      </td>
                    </tr>
                  ))
                )}
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 transition hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-800/40">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{fmt(r.created_at)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${toneFor(r.action)}`}>
                        {r.action}
                      </span>
                    </td>
                    <td className="truncate px-4 py-2.5 font-medium" title={r.username ?? ""}>{r.username ?? "—"}</td>
                    <td className="truncate px-4 py-2.5 text-muted-foreground">{r.domain ?? "—"}</td>
                    <td className="truncate px-4 py-2.5 text-muted-foreground" title={r.detail ?? ""}>{r.detail ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">
                      {r.decision ? (
                        <span className={["text-[10px] font-semibold",
                          r.decision === "answer" ? "text-emerald-600" :
                          r.decision === "approved" ? "text-emerald-600" :
                          r.decision === "rejected" ? "text-red-500" : "text-orange-500"].join(" ")}>
                          {r.decision}
                        </span>
                      ) : r.confidence != null ? (
                        <span className="text-[10px] text-muted-foreground">{Math.round(r.confidence * 100)}%</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-[11px] text-muted-foreground">
                      {loading ? "" : "No audit events match the current filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </PageShell>
  );
}
