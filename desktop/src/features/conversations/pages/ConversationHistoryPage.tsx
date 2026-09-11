import { useEffect, useMemo, useState } from "react";
import {
  FileJson,
  FileText,
  MessagesSquare,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { adminListConversations, adminConversationMessages, adminDownloadConversation } from "@/features/conversations/admin-api";
import { listUsers } from "@/features/users/api";
import { PageShell, PageHeader, SectionCard } from "@/components/ui/page";

/**
 * ConversationHistory — v0.21.75/79
 * Admin-only page: browse every user's chatbot conversations, read the full
 * transcript, and export as .txt / .json. Follows the standard page pattern
 * (PageShell + PageHeader icon chip + stat cards + SectionCard scroll table).
 */

type Conv = {
  session_id: string;
  username: string;
  title: string;
  messages: number;
  started_at: string | null;
  last_at: string | null;
};

type Msg = { role: string; content: string; created_at: string | null };

function fmt(ts: string | null): string {
  if (!ts) return "—";
  // Server times are UTC (timestamptz). Parse and render in the viewer's locale.
  const d = new Date(ts.endsWith("Z") || ts.includes("+") ? ts : ts + "Z");
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

const AVATAR_TONES = [
  "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300",
];

function toneFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/* v1.6.1 — mask profanity in org-facing titles */
const _PROFANITY_RE = new RegExp("\\b(f+u+c+k+|sh+i+t+|b+i+t+c+h+|a+s+s+h+o+l+e+|d+a+m+n+)\\b", "gi");
function maskProfanity(text: string): string {
  return (text || "").replace(_PROFANITY_RE, (m) => "✱".repeat(Math.min(6, m.length)));
}

export default function ConversationHistoryPage() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [filterUser, setFilterUser] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [openUser, setOpenUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Conv | null>(null);
  // v0.21.83 — audit date range + export actions moved into the detail panel
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  async function load() {
    setLoading(true);
    try {
      const d = await adminListConversations(filterUser || undefined);
      setConvs(d.conversations ?? []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [filterUser]);
  useEffect(() => {
    listUsers()
      .then((d) => setUsers((d.users ?? []).map((u: any) => u.username).sort()))
      .catch(() => {});
  }, []);

  async function view(c: Conv) {
    const d = await adminConversationMessages(c.session_id);
    setMsgs(d.messages ?? []); setOpen(c.session_id); setOpenUser(d.username ?? c.username);
    setDetail(c);
  }

  function closeDetail() { setOpen(null); setDetail(null); setMsgs([]); }

  function download(c: Conv, format: "txt" | "json") {
    adminDownloadConversation(c.session_id, format)
      .then((r) => r.blob())
      .then((b) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = `conversation-${c.username}-${c.session_id.slice(0, 8)}.${format}`;
        a.click();
      });
  }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return convs.filter((c) => {
      if (needle && !(c.title.toLowerCase().includes(needle) || c.username.toLowerCase().includes(needle)))
        return false;
      if (fromDate || toDate) {
        const day = (c.last_at ?? "").slice(0, 10);
        if (!day) return false;
        if (fromDate && day < fromDate) return false;
        if (toDate && day > toDate) return false;
      }
      return true;
    });
  }, [convs, q, fromDate, toDate]);

  const totalMsgs = convs.reduce((a, c) => a + c.messages, 0);
  const activeUsers = new Set(convs.map((c) => c.username)).size;

  return (
    <PageShell>
      <div className="text-[13px]">
        <PageHeader
          icon={<MessagesSquare className="size-5" />}
          title="Conversation History"
          badge="History"
          description="Every user's chatbot conversations — review transcripts and export."
          actions={
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-card px-4 py-2.5 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className={["size-4", loading ? "animate-spin" : ""].join(" ")} />
              Refresh
            </button>
          }
        />

        {/* Stat cards */}
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Conversations</div>
            <div className="mt-1 text-2xl font-bold text-sky-700 dark:text-sky-300">{convs.length}</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total messages</div>
            <div className="mt-1 text-2xl font-bold text-cyan-700 dark:text-cyan-300">{totalMsgs}</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Users active</div>
            <div className="mt-1 text-2xl font-bold text-teal-700 dark:text-teal-300">{activeUsers}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-full max-w-[320px] items-center gap-2 rounded-xl border bg-white px-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title or user…"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="h-10 rounded-xl border bg-white px-3 text-xs shadow-sm outline-none dark:border-slate-800 dark:bg-slate-900"
          >
            <option value="">All users</option>
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <div className="flex h-10 items-center gap-1.5 rounded-xl border bg-white px-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date"
              className="bg-transparent text-[11px] outline-none dark:[color-scheme:dark]" />
            <span className="text-[10px] text-muted-foreground">→</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date"
              className="bg-transparent text-[11px] outline-none dark:[color-scheme:dark]" />
            {(fromDate || toDate) && (
              <button type="button" onClick={() => { setFromDate(""); setToDate(""); }}
                className="rounded p-0.5 text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="size-3" />
              </button>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">
            Showing {shown.length} of {convs.length}
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* List table */}
          <SectionCard
            title="Conversations"
            description="Click a row to open the transcript panel."
            icon={<MessagesSquare className="size-4" />}
            bodyClassName=""
          >
            <div className="max-h-[540px] overflow-auto scroll-pb-2 pr-1">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-[26%]" /><col className="w-[44%]" />
                  <col className="w-[10%]" /><col className="w-[20%]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e2e8f0] dark:bg-slate-900 dark:shadow-[0_1px_0_#1e293b]">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Title</th>
                    <th className="px-4 py-3 font-semibold">Msgs</th>
                    <th className="px-4 py-3 font-semibold">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  
                {loading && (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={"sk" + i}>
                      <td colSpan={4} className="px-4 py-2.5">
                        <div className="h-4 animate-pulse rounded bg-muted" style={{ width: `${60 + ((i * 17) % 40)}%` }} />
                      </td>
                    </tr>
                  ))
                )}
{shown.map((c) => (
                    <tr
                      key={c.session_id}
                      onClick={() => view(c)}
                      title={c.title}
                      className={[
                        "cursor-pointer border-t border-slate-100 text-[11px] transition",
                        open === c.session_id
                          ? "bg-sky-50 dark:bg-sky-950/20"
                          : "hover:bg-sky-50/60 dark:hover:bg-sky-950/20",
                      ].join(" ")}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${toneFor(c.username)}`}>
                            {c.username.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="truncate font-semibold">{c.username}</span>
                        </div>
                      </td>
                      <td className="truncate px-4 py-2.5">{maskProfanity(c.title)}</td>
                      <td className="px-4 py-2.5">{c.messages}</td>
                      <td className="px-4 py-2.5">{fmt(c.last_at)}</td>
                    </tr>
                  ))}
                  {shown.length === 0 && !loading && (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-[11px] text-muted-foreground">
                      No conversations found.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* Detail side panel */}
          <div className="hidden lg:block">
            <div className="sticky top-8 flex h-[588px] flex-col overflow-hidden rounded-2xl border bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {detail ? (
                <>
                  <div className="border-b px-4 py-3 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold ${toneFor(openUser)}`}>
                          {openUser.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-semibold">{openUser}</div>
                          <div className="truncate text-[9.5px] text-muted-foreground">{detail.title}</div>
                        </div>
                      </div>
                      <button
                        onClick={closeDetail}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <button
                        onClick={() => download(detail, "txt")}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-700 px-2 py-1.5 text-[10px] font-semibold text-white transition hover:bg-sky-600"
                      >
                        <FileText className="size-3" /> Export .txt
                      </button>
                      <button
                        onClick={() => download(detail, "json")}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-2 py-1.5 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <FileJson className="size-3" /> Export .json
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[492px] space-y-2.5 overflow-y-auto p-4">
                    {msgs.map((m, i) => (
                      <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                        <span className={[
                          "inline-block max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-[11px] leading-relaxed",
                          m.role === "user"
                            ? "rounded-br-md bg-sky-600 text-white"
                            : "rounded-bl-md bg-slate-100 dark:bg-slate-800",
                        ].join(" ")}>
                          {m.content}
                        </span>
                        <div className="mt-1 text-[8.5px] text-muted-foreground">
                          {m.role === "user" ? "User" : "Assistant"} · {fmt(m.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                  <span className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
                    <MessagesSquare className="size-6" />
                  </span>
                  <div className="text-[12px] font-semibold">Select a conversation</div>
                  <p className="max-w-[240px] text-[10.5px] leading-relaxed text-muted-foreground">
                    Click any row in the list to read the full transcript here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
