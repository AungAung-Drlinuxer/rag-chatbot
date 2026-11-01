import { useEffect, useMemo, useState } from "react";
import {
  FileJson,
  FileText,
  MessagesSquare,
  RefreshCw,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { adminListConversations, adminConversationMessages, adminDownloadConversation } from "@/features/conversations/admin-api";
import { listUsers } from "@/features/users/api";
import { EmptyState, ErrorState, PageShell, PageHeader } from "@/components/ui/page";

/**
 * ConversationHistory — v0.21.75/79, restyled to the workspace mockup.
 *
 * Admin-only page: browse every user's chatbot conversations, read the full
 * transcript, and export as .txt / .json.
 *
 * Layout follows the mockup: ADMINISTRATION eyebrow + breadcrumb header, three figures,
 * one toolbar (search / user / date range / Reset) that drives BOTH the list and the
 * transcript panel, then a two-column body — the table on the left, a sticky transcript
 * on the right. The transcript is a rendering of the same messages the export writes, so
 * what you read here is what the download contains.
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

/** Day bucket for the transcript divider — "Today" / "12 Mar 2026". */
function dayLabel(ts: string | null): string {
  if (!ts) return "Unknown date";
  const d = new Date(ts.endsWith("Z") || ts.includes("+") ? ts : ts + "Z");
  if (Number.isNaN(d.getTime())) return ts;
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  if (same) return "Today";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
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

/** One figure per card, counted from the loaded list. */
function StatCard({
  icon,
  value,
  title,
  caption,
  loading,
}: {
  icon: React.ReactNode;
  value: string;
  title: string;
  caption: string;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-card p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs text-muted-foreground">{title}</span>
        <span className="text-[var(--primary)]">{icon}</span>
      </div>
      <div className="mt-2.5 text-3xl font-semibold tracking-tight">
        {loading ? <div className="h-8 w-14 animate-pulse rounded bg-muted" /> : value}
      </div>
      <p className="mt-1.5 text-2xs leading-tight text-muted-foreground">{caption}</p>
    </div>
  );
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
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Conv | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // v0.21.83 — audit date range + export actions moved into the detail panel
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  async function load() {
    setLoading(true);
    // There was no catch here at all: a failed request produced an unhandled rejection and
    // an empty table, which reads as "no conversations exist" rather than "the load failed".
    setError(null);
    try {
      const d = await adminListConversations(filterUser || undefined);
      setConvs(d.conversations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConvs([]);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [filterUser]);
  useEffect(() => {
    listUsers()
      .then((d) => setUsers((d.users ?? []).map((u: any) => u.username).sort()))
      .catch(() => {});
  }, []);

  async function view(c: Conv) {
    // Selecting a row used to await silently: a failed transcript fetch left the previous
    // conversation's messages under the new row's title. The panel now reports its own state.
    setOpen(c.session_id);
    setDetail(c);
    setOpenUser(c.username);
    setDetailLoading(true);
    setDetailError(null);
    setMsgs([]);
    try {
      const d = await adminConversationMessages(c.session_id);
      setMsgs(d.messages ?? []);
      setOpenUser(d.username ?? c.username);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setOpen(null);
    setDetail(null);
    setMsgs([]);
    setDetailError(null);
  }

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
  const filtered = q.trim() !== "" || fromDate !== "" || toDate !== "" || filterUser !== "";

  // Group the transcript by day so the panel can show the mockup's day dividers.
  const grouped = useMemo(() => {
    const out: { day: string; items: Msg[] }[] = [];
    for (const m of msgs) {
      const day = dayLabel(m.created_at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [msgs]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        breadcrumbs={["Workspace", "Conversations"]}
        title="Conversation history"
        description="Review conversations, explore transcripts, and keep context in one place."
        actions={
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={["size-3.5", loading ? "animate-spin" : ""].join(" ")} />
            Refresh
          </button>
        }
      />

      <main className="space-y-6">
        <section className="grid auto-rows-fr gap-4 md:grid-cols-3">
          <StatCard
            icon={<MessagesSquare className="size-4" />}
            value={String(convs.length)}
            title="Conversations"
            caption="Loaded from the current filter"
            loading={loading}
          />
          <StatCard
            icon={<FileText className="size-4" />}
            value={String(totalMsgs)}
            title="Total messages"
            caption="Across every loaded conversation"
            loading={loading}
          />
          <StatCard
            icon={<Search className="size-4" />}
            value={String(activeUsers)}
            title="Users active"
            caption="Distinct users in this result"
            loading={loading}
          />
        </section>

        {/* Toolbar — drives the list and the transcript panel together. */}
        <section className="flex flex-wrap items-center gap-2.5">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-card px-3 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title or user…"
              aria-label="Search conversations"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            aria-label="Filter by user"
            className="rounded-lg border border-[var(--border)] bg-card px-3 py-2 text-xs outline-none focus:border-[var(--primary)]"
          >
            <option value="">All users</option>
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
            className="w-[145px] rounded-lg border border-[var(--border)] bg-card px-3 py-2 text-xs outline-none focus:border-[var(--primary)] dark:[color-scheme:dark]"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
            className="w-[145px] rounded-lg border border-[var(--border)] bg-card px-3 py-2 text-xs outline-none focus:border-[var(--primary)] dark:[color-scheme:dark]"
          />
          <button
            type="button"
            onClick={() => { setQ(""); setFilterUser(""); setFromDate(""); setToDate(""); }}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-muted"
          >
            Reset
          </button>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(430px,1fr)_360px]">
          {/* List table */}
          <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-card shadow-xs">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <h2 className="text-sm font-semibold">
                Conversations
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-2xs font-normal text-muted-foreground">
                  {shown.length}
                </span>
              </h2>
              <span className="text-2xs text-muted-foreground">Newest first</span>
            </div>

            <div className="max-h-[560px] overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted/60 text-3xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Conversation</th>
                    <th className="px-5 py-3 font-medium">Messages</th>
                    <th className="px-5 py-3 font-medium">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={"sk" + i} className="border-t border-[var(--border)]">
                        <td colSpan={3} className="px-5 py-3">
                          <div className="h-4 animate-pulse rounded bg-muted" style={{ width: `${60 + ((i * 17) % 40)}%` }} />
                        </td>
                      </tr>
                    ))
                  )}
                  {!loading && shown.map((c) => (
                    <tr
                      key={c.session_id}
                      onClick={() => view(c)}
                      className={[
                        "cursor-pointer border-t border-[var(--border)] text-xs transition",
                        open === c.session_id
                          ? "bg-[var(--accent-soft)] shadow-[inset_3px_0_var(--primary)]"
                          : "hover:bg-muted/50",
                      ].join(" ")}
                    >
                      <td className="px-5 py-4 align-top">
                        <div className="flex items-start gap-2.5">
                          <span className={`grid size-7 shrink-0 place-items-center rounded-full text-2xs font-bold ${toneFor(c.username)}`}>
                            {c.username.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium leading-snug text-foreground"
                                 style={{ whiteSpace: "normal", minWidth: 210, maxWidth: 300 }}>
                              {maskProfanity(c.title) || "(untitled conversation)"}
                            </div>
                            <div className="mt-0.5 text-2xs text-muted-foreground">{c.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top text-muted-foreground">{c.messages}</td>
                      <td className="px-5 py-4 align-top text-muted-foreground">{fmt(c.last_at)}</td>
                    </tr>
                  ))}
                  {error && !loading && (
                    <tr>
                      <td colSpan={3}>
                        <ErrorState
                          compact
                          title="Could not load conversation history"
                          detail={error}
                          onRetry={() => void load()}
                        />
                      </td>
                    </tr>
                  )}
                  {shown.length === 0 && !loading && !error && (
                    <tr><td colSpan={3}>
                      {convs.length === 0 ? (
                        <EmptyState
                          icon={<MessagesSquare className="size-5" />}
                          title="No conversations yet"
                          description="Chat sessions appear here once users start asking the assistant questions."
                        />
                      ) : (
                        <EmptyState
                          icon={<SearchX className="size-5" />}
                          title="No conversations match these filters"
                          description={`${convs.length} conversation${convs.length === 1 ? "" : "s"} loaded, but none match the current search or date range.`}
                          actionLabel="Clear filters"
                          onAction={() => { setQ(""); setFromDate(""); setToDate(""); setFilterUser(""); }}
                        />
                      )}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-t border-[var(--border)] px-5 py-3 text-2xs text-muted-foreground">
              Showing {shown.length} of {convs.length} conversation{convs.length === 1 ? "" : "s"}
              {filtered ? " (filtered)" : ""} · {totalMsgs} message{totalMsgs === 1 ? "" : "s"} in
              this result
            </div>
          </section>

          {/* Detail side panel */}
          <div className="hidden lg:block">
            <div className="sticky top-8 flex h-[588px] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-card shadow-xs">
              {detail ? (
                <>
                  <div className="border-b border-[var(--border)] px-5 py-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold ${toneFor(openUser)}`}>
                          {openUser.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold">{openUser}</h3>
                          <div className="truncate text-2xs text-muted-foreground">{maskProfanity(detail.title)}</div>
                        </div>
                      </div>
                      <button
                        onClick={closeDetail}
                        aria-label="Close transcript"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center gap-1.5">
                      <button
                        onClick={() => download(detail, "txt")}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-2 py-1.5 text-2xs font-semibold text-[var(--primary-foreground)] transition hover:opacity-90"
                      >
                        <FileText className="size-3" /> Export .txt
                      </button>
                      <button
                        onClick={() => download(detail, "json")}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1.5 text-2xs font-semibold transition hover:bg-muted"
                      >
                        <FileJson className="size-3" /> Export .json
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto bg-muted/20 p-4">
                    {detailLoading && (
                      <div className="space-y-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div
                            key={i}
                            className="h-10 animate-pulse rounded-xl bg-muted"
                            style={{ width: `${55 + ((i * 13) % 35)}%`, marginLeft: i % 2 ? "auto" : 0 }}
                          />
                        ))}
                      </div>
                    )}
                    {detailError && !detailLoading && (
                      <ErrorState
                        compact
                        title="Could not load this transcript"
                        detail={detailError}
                        onRetry={() => void view(detail)}
                      />
                    )}
                    {!detailLoading && !detailError && msgs.length === 0 && (
                      <div className="grid h-full place-items-center p-6 text-center text-2xs text-muted-foreground">
                        This conversation has no stored messages.
                      </div>
                    )}
                    {!detailLoading && !detailError && grouped.map((g) => (
                      <div key={g.day} className="space-y-2.5">
                        <div className="flex items-center gap-2 text-3xs uppercase tracking-wider text-muted-foreground">
                          <span className="h-px flex-1 bg-[var(--border)]" />
                          {g.day}
                          <span className="h-px flex-1 bg-[var(--border)]" />
                        </div>
                        {g.items.map((m, i) => (
                          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                            <span className={[
                              "inline-block max-w-[88%] whitespace-pre-wrap px-3.5 py-2 text-left text-xs leading-relaxed",
                              m.role === "user"
                                ? "rounded-[12px_3px_12px_12px] bg-[var(--primary)] text-[var(--primary-foreground)]"
                                : "rounded-[3px_12px_12px_12px] border border-[var(--border)] bg-card",
                            ].join(" ")}>
                              {m.content}
                            </span>
                            <div className="mt-1 text-3xs text-muted-foreground">
                              {m.role === "user" ? "User" : "Assistant"} · {fmt(m.created_at)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* Honest footer: the panel shows what the API returned, nothing more. */}
                  {!detailLoading && !detailError && msgs.length > 0 && (
                    <div className="border-t border-[var(--border)] px-5 py-2.5 text-3xs text-muted-foreground">
                      {msgs.length} message{msgs.length === 1 ? "" : "s"} in this transcript
                      {detail.messages > msgs.length
                        ? ` · ${detail.messages - msgs.length} more recorded than returned`
                        : ""}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                  <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                    <MessagesSquare className="size-6" />
                  </span>
                  <div className="text-xs font-semibold">Select a conversation</div>
                  <p className="max-w-[240px] text-2xs leading-relaxed text-muted-foreground">
                    Click any row in the list to read the full transcript here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="text-2xs leading-relaxed text-muted-foreground">
          Transcripts are read-only. Exports contain exactly the messages stored for the
          session; nothing is redacted beyond the profanity mask applied to titles.
        </p>
      </main>
    </PageShell>
  );
}
