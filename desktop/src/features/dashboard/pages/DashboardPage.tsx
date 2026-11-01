import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Eye,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  Ticket,
  Users,
} from "lucide-react";
import { EmptyState, ErrorState, PageHeader, PageShell } from "@/components/ui/page";

import { useEffect, useState } from "react";

import {
  dashStats,
  dashConversations,
  dashDomains,
  dashRecentConversations,
  dashRecentTickets,
  dashHealth,
  dashGateTrend,
  type ReportWindow,
} from "@/features/dashboard/api";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/* ============================================================
   TYPES
============================================================ */

type Props = {
  userName?: string;
  role?: string;
  // `onNavigate` went with the Quick actions row: it was that row's only reader, and
  // App.tsx never passed it (the sidebar is the navigation path).
};


import type { Conversation, RecentTicket, Domain, HealthItem } from "@/features/dashboard/lib/dashboardTypes";
import { healthIcon, maskProfanity } from "@/features/dashboard/lib/dashboardUtils";
import { Legend, ConversationChart, DonutChart, GateTrendChart } from "@/features/dashboard/components/DashboardCharts";
import { KpiCard, EscalationRow, DomainRow, HealthRow } from "@/features/dashboard/components/DashboardRows";
import { SectionHeader, ResultBadge, StatusBadge, PriorityBadge, DashboardReportButtons } from "@/features/dashboard/components/DashboardBits";

export default function Dashboard({ role }: Props) {
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] =
    useState(new Date());
  // The COMMITTED reporting window is the state. The picker's controls are only ways to
  // set it, so opening the picker — or typing half a range into the date boxes — cannot
  // change what is being reported. (An earlier version kept `range` and the dates in
  // separate state and refetched the same 7 days the moment the picker was opened.)
  const [win, setWin] = useState<ReportWindow>({ kind: "preset", days: 7 });
  // The date boxes hold a DRAFT; "Apply range" commits it into `win`.
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  // What the backend actually reported, so the footer names the real window rather than
  // repeating the request (the backend clamps a span it considers too long).
  const [windowEcho, setWindowEcho] = useState<{ start: string; end: string } | null>(null);

  // Real API data (v0.12.0)
  const [stats, setStats] = useState<any>(null);
  const [series, setSeries] = useState<{ day: string; total: number; resolved: number; escalated: number }[]>([]);
  const [domainsLive, setDomainsLive] = useState<Domain[] | null>(null);
  const [liveConversations, setLiveConversations] = useState<Conversation[] | null>(null);
  const [liveTickets, setLiveTickets] = useState<RecentTicket[] | null>(null);
  const [liveHealth, setLiveHealth] = useState<HealthItem[] | null>(null);
  const [gateTrend, setGateTrend] = useState<{ day: string; answered: number; cautioned: number }[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // #3/#11 — overall status + the failing dependency names + the guardrail metric
  // (a security counter, no longer disguised as a service).
  const [healthSummary, setHealthSummary] = useState<{
    overall: string;
    down: string[];
    guardrailEvents: number;
  }>({ overall: "Healthy", down: [], guardrailEvents: 0 });

  // #19 — the "Last updated" footer was frozen at mount time. Poll every 60s so a
  // dashboard left open does not show stale figures, and re-render a relative age.
  const [nowTick, setNowTick] = useState(0);
  void nowTick; // drives the relative-age re-render
  useEffect(() => {
    const id = window.setInterval(() => {
      setRefreshTick((v) => v + 1);
      setNowTick((v) => v + 1);
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((v) => v + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  // --- reporting window -------------------------------------------------------------
  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const rangeLabel =
    win.kind === "custom"
      ? `${shortDate(win.start)} → ${shortDate(win.end)}`
      : `Last ${win.days} days`;

  const todayIso = new Date().toISOString().slice(0, 10);
  const customInvalid =
    !!customFrom && !!customTo && (customFrom > customTo || customFrom > todayIso);

  // KPI row: 5 cards for a user (4 metrics + KB Articles), 6 for an admin (+ Attacks
  // Blocked). A 4-column grid left a 1- or 2-card orphan row — that ragged tail is what
  // made the row look uneven. Pick a column count that divides the cards exactly, and
  // when the count is odd let the last card span two columns to close the row.
  const kpiCount = role === "admin" ? 6 : 5;
  const kpiFillLast = kpiCount % 2 === 1;

  useEffect(() => {
    let mounted = true;

    async function load() {
    setLoadError(null);
      try {
        const [s, c, d, rc, rt, h, g] = await Promise.all([
          dashStats(),
          dashConversations(win),
          dashDomains(),
          dashRecentConversations(6),
          dashRecentTickets(5),
          dashHealth(),
          dashGateTrend(win),
        ]);
        if (!mounted) return;
        setStats(s ?? null);
        if (g?.series?.length) setGateTrend(g.series);
        if (c?.series?.length) setSeries(c.series);
        if (c?.start && c?.end) setWindowEcho({ start: c.start, end: c.end });
        if (d?.domains?.length) {
          setDomainsLive(d.domains.map((x: { name: string; count: number; percentage: number }) => ({
            name: x.name, count: x.count, percentage: x.percentage,
            icon: <BarChart3 className="size-4" />,
          })));
        }
        if (rc?.conversations?.length) setLiveConversations(rc.conversations);
        if (rt?.tickets?.length) {
          const norm = (s: string) => {
            const v = (s || "").toLowerCase();
            if (v === "created" || v === "open") return "Open";
            if (v === "pending" || v === "in progress") return "Pending";
            if (v === "resolved" || v === "done" || v === "closed") return "Resolved";
            return "Open";
          };
          const prio = (s: string) => {
            const v = (s || "").toLowerCase();
            return v.charAt(0).toUpperCase() + v.slice(1);
          };
          setLiveTickets(rt.tickets.map((t: any) => ({
            ...t,
            status: norm(t.status),
            priority: prio(t.priority),
          })));
        }
        // #11/#12 — the endpoint now returns {services, security, overall, down}.
        if (h?.services?.length) {
          setLiveHealth(h.services.map((x: any) => ({
            key: x.key,
            name: x.name,
            status: (x.status === "Healthy" ? "Healthy" : "Down") as HealthItem["status"],
            detail: x.detail ?? null,
            latency_ms: x.latency_ms ?? null,
            icon: healthIcon(x.key),
          })));
          setHealthSummary({
            overall: h.overall ?? "Healthy",
            down: h.down ?? [],
            guardrailEvents: h.security?.guardrail_events_7d ?? 0,
          });
        }
      } catch (err) {
        // This used to read "keep sample fallbacks on failure" — a leftover from a version
        // that seeded demo numbers. There are no fallbacks any more, so a failure left every
        // metric at null with nothing said: the page looked like a genuinely quiet day.
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted) {
          setLoading(false);
          setLastUpdated(new Date());
        }
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [refreshTick, win]);

  function refreshDashboard() {
    setLoading(true);
    setLastUpdated(new Date());
    setRefreshTick((v) => v + 1);
  }

  // #4/#5 — week-over-week pill, with two honesty guards:
  //  * a percentage computed from a tiny baseline is arithmetically true but
  //    useless (11 -> 136 renders as "+1136.4%"), so we label the baseline
  //    instead of printing a 4-digit number;
  //  * a card with no delta must still SAY something — an empty description
  //    beside "vs previous 7 days" read as a broken card.
  function deltaInfo(key: string, current: number): {
    change: string | null;
    positive: boolean;
    description: string;
  } {
    const d = (stats as any)?.deltas?.[key];
    const prev = (stats as any)?.previous?.[key];
    if (d == null || prev == null) {
      return {
        change: null,
        positive: true,
        description:
          prev === 0 && current > 0
            ? "new this week"
            : "no prior-week baseline",
      };
    }
    if (prev < 10) {
      // Baseline too small for a meaningful percentage.
      return { change: null, positive: d >= 0, description: `up from ${prev} last week` };
    }
    if (Math.abs(d) >= 300) {
      // Past ~3x the percentage stops being readable ("+1136.4%"). A multiplier is
      // the honest, legible form: "12.4x vs last week".
      const mult = prev > 0 ? current / prev : 0;
      return {
        change: null,
        positive: d >= 0,
        description: `${mult.toFixed(1)}× last week`,
      };
    }
    return {
      change: `${d >= 0 ? "+" : "−"}${Math.abs(d)}%`,
      positive: d >= 0,
      description: "vs previous 7 days",
    };
  }

  /** Spread-ready variant so each KPI card spreads change/positive/description. */
  function deltaProps(key: string, current: number) {
    return deltaInfo(key, current);
  }

    return (
    <PageShell>
      <PageHeader
      breadcrumbs={["Workspace", "Overview"]}
      eyebrow="Administration"
      icon={<Activity className="size-5" />}
      badge={role === "admin" ? "Administrator" : "User"}
      title="Workspace overview"
      description="A clear view of support activity, knowledge, and system health."
      actions={<>
        {/* #15 — the reporting window is a FILTER, so it reads left-to-right
            before the actions that operate within it. */}
        <div className="relative hidden sm:block">
                <button
                  type="button"
                  onClick={() => setRangeOpen((v) => !v)}
                  title="Reporting window"
                  className={[
                    "flex h-8 items-center gap-2 rounded-lg border bg-white px-2.5 text-2xs font-medium transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800",
                    win.kind === "custom" ? "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300" : "",
                  ].join(" ")}
                >
                  <CalendarDays className="size-3.5" />
                  {rangeLabel}
                  <ChevronDown className={`size-3 text-muted-foreground transition ${rangeOpen ? "rotate-180" : ""}`} />
                </button>
                {rangeOpen && (
                  <div className="absolute right-0 top-11 z-20 w-64 rounded-xl border bg-white p-1.5 shadow-lg dark:bg-slate-900">
                    {([7, 30, 90] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => {
                          // Re-picking the active preset returns the SAME object, so the
                          // load effect does not re-run for a no-op.
                          setWin((w) => (w.kind === "preset" && w.days === r ? w : { kind: "preset", days: r }));
                          setRangeOpen(false);
                        }}
                        className={[
                          "block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800",
                          win.kind === "preset" && win.days === r ? "font-semibold text-blue-600" : "text-slate-700 dark:text-slate-200",
                        ].join(" ")}
                      >
                        Last {r} days
                      </button>
                    ))}

                    {/* Custom range — a real start/end window, not a day count. */}
                    <div className="mt-1 border-t pt-1.5">
                      <p
                        className={[
                          "px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide",
                          win.kind === "custom" ? "text-blue-600" : "text-muted-foreground",
                        ].join(" ")}
                      >
                        Custom range
                      </p>

                      <div className="space-y-2 px-3 pb-1 pt-1">
                        <label className="block">
                          <span className="text-2xs font-medium text-muted-foreground">From</span>
                          <input
                            type="date"
                            value={customFrom}
                            max={todayIso}
                            onChange={(e) => setCustomFrom(e.target.value)}
                            className="mt-0.5 h-7 w-full rounded-md border bg-white px-2 text-xs dark:bg-slate-950"
                          />
                        </label>
                        <label className="block">
                          <span className="text-2xs font-medium text-muted-foreground">To</span>
                          <input
                            type="date"
                            value={customTo}
                            max={todayIso}
                            onChange={(e) => setCustomTo(e.target.value)}
                            className="mt-0.5 h-7 w-full rounded-md border bg-white px-2 text-xs dark:bg-slate-950"
                          />
                        </label>

                        {customInvalid && (
                          <p className="text-2xs leading-tight text-rose-600">
                            {customFrom > todayIso
                              ? "Start date is in the future."
                              : "Start date must be on or before the end date."}
                          </p>
                        )}

                        <button
                          type="button"
                          disabled={!customFrom || !customTo || customInvalid}
                          onClick={() => {
                            setWin({ kind: "custom", start: customFrom, end: customTo });
                            setRangeOpen(false);
                          }}
                          className="h-7 w-full rounded-md bg-blue-600 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Apply range
                        </button>
                      </div>
                    </div>
                  </div>
                )}
        </div>

        <Button variant="outline" size="sm" className="rounded-xl" onClick={refreshDashboard}>
          <RefreshCw className={["mr-2 size-3.5", loading ? "animate-spin" : ""].join(" ")} />
          Refresh
        </Button>

        {/* #14 — "Report" was the only saturated/primary button in the header, which
            read as the page's most important action. Printing is secondary; it is now
            an outline button alongside Export CSV. */}
        <DashboardReportButtons
          stats={stats}
          conversations={liveConversations ?? []}
          tickets={liveTickets ?? []}
          domains={domainsLive ?? []}
        />
      </>}
    />

          {/* =================================================
              CONTENT
          ================================================= */}

          <div className="space-y-5">

            {/* A failure banner rather than a full-page error: some cards load from
                different endpoints, so whatever DID arrive stays visible and useful. The
                banner says which load failed and offers a retry. */}
            {loadError && !loading && (
              <ErrorState
                banner
                title="Some dashboard data could not be loaded"
                detail={loadError}
                onRetry={refreshDashboard}
                retryLabel="Retry"
              />
            )}

            {/* KPI */}

            {/* Nothing has happened in the selected window. Shown instead of a grid of
                zeroes, which reads as "the system is idle" rather than "no data exists" —
                a new install with an empty database produces exactly this. */}
            {!loading && !loadError && stats === null && series.length === 0 && !liveTickets?.length && !liveConversations?.length ? (
              <EmptyState
                icon={<Activity className="size-5" />}
                title="No activity in this reporting window"
                description="Nothing has been recorded for the selected period. Try a wider range, or check that the chat and ticket integrations are connected in Settings."
                actionLabel="Widen to 90 days"
                onAction={() => setWin({ kind: "preset", days: 90 })}
              />
            ) : (
            <>
            <section className="grid auto-rows-fr gap-4 md:grid-cols-2 xl:grid-cols-3">

              <KpiCard
                icon={
                  <MessageSquare className="size-4" />
                }
                value={stats ? String(stats.total_conversations) : "—"}
                title="Total Conversations"
                {...deltaProps("total_conversations", stats?.total_conversations ?? 0)}
                loading={loading}
              />

              <KpiCard
                tone="emerald"
                icon={<CheckCircle2 className="size-4" />}
                value={stats ? String(stats.resolved_by_bot) : "—"}
                title="Resolved by Bot"
                {...deltaProps("resolved_by_bot", stats?.resolved_by_bot ?? 0)}
                loading={loading}
              />

              <KpiCard
                tone="orange"
                icon={<Ticket className="size-4" />}
                value={stats ? String(stats.escalated_to_tickets) : "—"}
                title="Escalated to Tickets"
                /* v1.5.3 — hide the delta when zero escalations: "−100%" confuses users */
                change={stats?.escalated_to_tickets === 0 ? null : deltaInfo("escalated_to_tickets", stats?.escalated_to_tickets ?? 0).change}
                positive={(stats?.deltas?.escalated_to_tickets ?? 0) < 0}
                description={stats?.escalated_to_tickets === 0 ? "no escalations this week" : deltaInfo("escalated_to_tickets", 0).description}
                loading={loading}
              />

              <KpiCard
                tone="sky"
                icon={<Users className="size-4" />}
                value={stats ? String(stats.active_users) : "—"}
                title="Active Users"
                {...deltaProps("active_users", stats?.active_users ?? 0)}
                loading={loading}
              />

              <KpiCard
                tone="violet"
                icon={<BookOpen className="size-4" />}
                value={stats ? String(stats.kb_pages ?? "—") : "—"}
                title="KB Articles"
                description="Knowledge base size"
                loading={loading}
                /* closes the row when the card count is odd (5) */
                className={kpiFillLast ? "md:col-span-2 xl:col-span-2" : undefined}
              />

              {role === "admin" && (
                <KpiCard
                  tone="rose"
                  icon={<ShieldAlert className="size-4" />}
                  value={stats ? String(stats.attacks_blocked_7d ?? 0) : "—"}
                  title="Attacks Blocked (7d)"
                  description="Injection + overflow - 7d"
                  loading={loading}
                />
              )}

            </section>

            {/* =================================================
                CHART ROW
            ================================================= */}

            <section className="grid items-stretch gap-4 xl:grid-cols-3">

              {/* Conversations */}

              <Card className="rounded-xl border-[var(--border)] p-5">

                <div className="flex items-start justify-between gap-3">

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">
                        Conversations over time
                      </h2>

                      {stats && (
                        <span className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-2xs font-medium text-muted-foreground">
                          {stats.total_conversations} total
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      Daily conversation volume - last 7 days
                    </p>

                    <div className="mt-3 flex items-center gap-4 text-2xs text-muted-foreground">

                      <Legend
                        label="Total conversations"
                        className="bg-blue-500"
                      />

                      <Legend
                        label="Resolved by Bot"
                        className="bg-emerald-500"
                      />

                      <Legend
                        label="Escalated"
                        className="bg-orange-500"
                      />

                    </div>
                  </div>

                </div>

                <ConversationChart data={series} />

              </Card>

              {/* Escalation */}

              <Card className="rounded-xl border-[var(--border)] p-5">

                <div>
                  <h2 className="text-sm font-semibold">
                    Conversation outcomes
                  </h2>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    As reported by the summary cards
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-center">

                  <DonutChart stats={stats} />

                </div>

                <div className="mt-5 space-y-3">

                  {(() => {
                    const tot = stats?.total_conversations ?? 0;
                    const res = stats?.resolved_by_bot ?? 0;
                    const esc = stats?.escalated_to_tickets ?? 0;
                    const oth = Math.max(0, tot - res - esc);
                    const pc = (n: number) => (tot > 0 ? `${Math.round((n / tot) * 1000) / 10}%` : "0%");
                    return (
                      <>
                        <EscalationRow
                          color="bg-emerald-500"
                          label="Resolved by bot"
                          value={stats ? String(res) : "—"}
                          percentage={pc(res)}
                        />

                        <EscalationRow
                          color="bg-orange-500"
                          label="Escalated"
                          value={stats ? String(esc) : "—"}
                          percentage={pc(esc)}
                        />

                        <EscalationRow
                          color="bg-slate-300"
                          label="Other / no action"
                          value={stats ? String(oth) : "—"}
                          percentage={pc(oth)}
                        />
                      </>
                    );
                  })()}

                </div>

              </Card>

              {/* Domains */}

              <Card className="rounded-xl border-[var(--border)] p-5">

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">
                      Knowledge by domain
                    </h2>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      Source domain counts{stats?.kb_pages != null ? ` - ${stats.kb_pages} articles` : ""}
                    </p>
                  </div>

                  <span className="shrink-0 rounded-md bg-[var(--muted)] px-2 py-0.5 text-2xs font-medium text-muted-foreground">
                    All content
                  </span>
                </div>

                <div className="mt-5 space-y-4">

                  {(domainsLive ?? []).length === 0 && (
                    <div className="px-4 py-6 text-center text-2xs text-muted-foreground">
                      No domain data yet.
                    </div>
                  )}

                  {(domainsLive ?? []).map((domain) => (
                    <DomainRow
                      key={domain.name}
                      domain={domain}
                    />
                  ))}

                </div>

              </Card>

            </section>

            {/* =================================================
                CONFIDENCE GATE TREND (v1.1.6 — real meta.decision data)
            ================================================= */}

            <Card className="rounded-xl p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Confidence gate trend</h2>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    Answers passing the 0.75 threshold vs cautioned responses
                  </p>
                </div>
                <div className="flex items-center gap-4 text-2xs text-muted-foreground">
                  <Legend label="Answered" className="bg-emerald-500" />
                  <Legend label="Cautioned" className="bg-amber-500" />
                </div>
              </div>
              {gateTrend.length === 0 ? (
                <div className="py-10 text-center text-2xs text-muted-foreground">
                  No gate data yet — trends appear as users chat.
                </div>
              ) : (
                <GateTrendChart data={gateTrend} />
              )}
            </Card>

            {/* =================================================
                LOWER ROW
            ================================================= */}

            {/* #7 — items-start stops the grid from stretching short panels to the
                tallest sibling, which left ~400px of dead space under both tables. */}
            <section className="grid items-stretch gap-4 xl:grid-cols-3">

              {/* Recent conversations */}

              <Card className="flex flex-col overflow-hidden rounded-xl border-[var(--border)]">

                <SectionHeader
                  title="Recent conversations"
                  pill={liveConversations ? String(liveConversations.length) : undefined}
                                  />

                <div className="max-h-[360px] min-h-0 flex-1 overflow-y-auto xl:max-h-none">

                  {/* Mobile: stacked cards (md:hidden) */}
                  <div className="divide-y md:hidden">
                    {(liveConversations ?? []).length === 0 && (
                      <p className="px-4 py-8 text-center text-2xs text-muted-foreground">
                        No conversations yet — data appears as users chat.
                      </p>
                    )}

                    {(liveConversations ?? []).map((conversation) => (
                      <div
                        key={`${conversation.time}-${conversation.user}`}
                        className="space-y-1.5 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 min-w-0">
                            <ResultBadge result={conversation.result} />
                            <span className="truncate text-xs font-medium" title={conversation.user}>
                              {conversation.user}
                            </span>
                          </span>
                          <span
                            className="shrink-0 text-2xs text-muted-foreground"
                            title={conversation.time}
                          >
                            {(() => {
                              const d = conversation.time ? new Date(conversation.time.endsWith("Z") || conversation.time.includes("+") ? conversation.time : conversation.time + "Z") : null;
                              return d && !Number.isNaN(d.getTime())
                                ? d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
                                : conversation.time;
                            })()}
                          </span>
                        </div>

                        <p className="truncate text-xs" title={maskProfanity(conversation.question)}>
                          {maskProfanity(conversation.question)}
                        </p>

                        <button
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent("ith:view-conversation", {
                              detail: { user: conversation.user, question: conversation.question },
                            }));
                          }}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                        >
                          <Eye className="size-3.5" />
                          View
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Desktop: table (hidden below md) */}
                  <table className="hidden w-full table-fixed text-xs md:table">

                    <colgroup>
                      {/* #8 — Time widened: "Sep 13, 16:59" was truncated to
                          "Sep 13, 16:5…" at 14%. */}
                      <col className="w-[17%]" />

                      <col className="w-[15%]" />

                      <col className="w-[36%]" />

                      <col className="w-[13%]" />

                      <col className="w-[19%]" />

                    </colgroup>

                    <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">

                      <tr className="text-left text-2xs text-muted-foreground">

                        <th className="px-4 py-3">
                          Time
                        </th>

                        <th className="px-4 py-3">
                          User
                        </th>

                        <th className="px-4 py-3">
                          Question
                        </th>

                        <th className="px-4 py-3">
                          Result
                        </th>

                        <th className="px-4 py-3">
                          Action
                        </th>

                      </tr>

                    </thead>

                    <tbody>

                      {(liveConversations ?? []).length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-2xs text-muted-foreground">
                            No conversations yet — data appears as users chat.
                          </td>
                        </tr>
                      )}

                      {(liveConversations ?? []).map(
                        (conversation) => (
                          <tr
                            key={`${conversation.time}-${conversation.user}`}
                            className="border-t hover:bg-slate-50 dark:hover:bg-slate-900/50"
                          >

                            {/* #8 — date and time on separate lines; the single-line
                                form was clipped and hid the minutes. */}
                            <td className="px-4 py-3 text-2xs leading-tight text-muted-foreground" title={conversation.time}>
                              {(() => {
                                const d = conversation.time ? new Date(conversation.time.endsWith("Z") || conversation.time.includes("+") ? conversation.time : conversation.time + "Z") : null;
                                if (!d || Number.isNaN(d.getTime())) return conversation.time;
                                return (
                                  <span className="flex flex-col">
                                    <span>{d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}</span>
                                    <span className="tabular-nums">
                                      {d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
                                    </span>
                                  </span>
                                );
                              })()}
                            </td>

                            <td className="max-w-[120px] truncate px-4 py-3 text-2xs font-medium" title={conversation.user}>
                              {conversation.user}
                            </td>

                            <td className="max-w-[190px] truncate px-4 py-3 text-2xs" title={maskProfanity(conversation.question)}>
                              {maskProfanity(conversation.question)}
                            </td>

                            <td className="px-4 py-3">
                              <ResultBadge
                                result={
                                  conversation.result
                                }
                              />
                            </td>

                            <td className="px-4 py-3">
                              <button
                                onClick={() => {
                                  window.dispatchEvent(new CustomEvent("ith:view-conversation", {
                                    detail: { user: conversation.user, question: conversation.question },
                                  }));
                                }}
                                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                              >
                                <Eye className="size-3.5" />
                                View
                              </button>
                            </td>

                          </tr>
                        )
                      )}

                    </tbody>

                  </table>

                </div>

              </Card>

              {/* Recent tickets */}

              <Card className="flex flex-col overflow-hidden rounded-xl border-[var(--border)]">

                <SectionHeader
                  title="Recent tickets"
                  pill={
                    liveTickets
                      ? `${liveTickets.filter((t) => t.status === "Open").length} open`
                      : undefined
                  }
                                  />

                <div className="max-h-[360px] min-h-0 flex-1 divide-y overflow-y-auto xl:max-h-none">

                  {(liveTickets ?? []).length === 0 && (
                    <div className="px-4 py-8 text-center text-2xs text-muted-foreground">
                      No tickets yet — escalations will appear here.
                    </div>
                  )}

                  {(liveTickets ?? []).map((ticket) => (
                    <div
                      key={ticket.id}
                      className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-slate-50 dark:hover:bg-slate-900/50"
                    >

                      <div className="w-14 shrink-0 text-2xs font-semibold text-blue-600">
                        {ticket.id}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">
                          {ticket.subject}
                        </div>
                      </div>

                      <StatusBadge
                        status={ticket.status}
                      />

                      <PriorityBadge
                        priority={ticket.priority}
                      />

                    </div>
                  ))}

                </div>

              </Card>

              {/* System health */}

              <Card className="flex flex-col overflow-hidden rounded-xl border-[var(--border)]">

                {/* #3 — three items packed into one flex row squeezed the title and
                    wrapped the badge onto two lines. Title + status line stack on the
                    left; the badge and the Grafana link occupy a shrink-0 right group. */}
                <div className="flex items-start justify-between gap-3 border-b px-5 py-3.5">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold leading-tight">System health</h2>
                    <p className="mt-0.5 truncate text-2xs leading-tight text-muted-foreground">
                      {(liveHealth ?? []).length === 0
                        ? "Checking dependencies…"
                        : healthSummary.down.length > 0
                          ? `Failing: ${healthSummary.down.join(", ")}`
                          : `${(liveHealth ?? []).length} dependencies reporting healthy`}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className={[
                      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-2xs font-medium",
                      healthSummary.overall === "Healthy"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : healthSummary.overall === "Down"
                          ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                          : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                    ].join(" ")}>
                      <span
                        aria-hidden
                        className={[
                          "size-1.5 rounded-full",
                          healthSummary.overall === "Healthy"
                            ? "bg-emerald-500"
                            : healthSummary.overall === "Down"
                              ? "bg-rose-500"
                              : "bg-amber-500",
                        ].join(" ")}
                      />
                      {healthSummary.overall}
                    </span>

                    <a
                      href="http://10.10.10.18:3000/d/rag-platform-health"
                      target="_blank"
                      rel="noreferrer"
                      title="Open full observability in Grafana"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                    >
                      <ExternalLink className="size-3" />
                      Grafana
                    </a>
                  </div>
                </div>

                <div className="divide-y">
                  {(liveHealth ?? []).length === 0 && (
                    <div className="px-4 py-6 text-center text-2xs text-muted-foreground">
                      Health data unavailable.
                    </div>
                  )}

                  {(liveHealth ?? []).map((item) => (
                    <HealthRow key={item.key ?? item.name} item={item} />
                  ))}

                  {/* #11 — guardrail activity is a SECURITY metric, not a dependency,
                      so it gets its own labelled block instead of sitting in the
                      service list pretending to be "Healthy". */}
                  <div className="mt-auto flex items-center gap-3 bg-slate-50/60 px-5 py-2.5 dark:bg-slate-900/40">
                    <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                      <ShieldAlert className="size-3.5" />
                    </div>
                    <span className="flex-1 text-2xs font-medium">
                      Guardrail activity
                      <span className="ml-1 font-normal text-muted-foreground">last 7 days</span>
                    </span>
                    <span className="text-2xs text-muted-foreground">
                      {healthSummary.guardrailEvents} event{healthSummary.guardrailEvents === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

              </Card>

            </section>
            </>
            )}

            {/* =================================================
                FOOTER
            ================================================= */}

            <div className="flex flex-col items-center justify-center gap-2 py-1 text-2xs text-muted-foreground sm:flex-row">

              <span
                title={
                  windowEcho
                    ? `${shortDate(windowEcho.start)} → ${shortDate(windowEcho.end)}`
                    : rangeLabel
                }
              >
                {windowEcho
                  ? `${shortDate(windowEcho.start)} → ${shortDate(windowEcho.end)}`
                  : rangeLabel}
              </span>

              <span className="hidden sm:block">|</span>

              <span title={lastUpdated.toLocaleString()}>
                Last updated:{" "}
                {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                <span className="ml-1 opacity-70">
                  ({(() => {
                    const secs = Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
                    if (secs < 60) return `${secs}s ago`;
                    const mins = Math.floor(secs / 60);
                    return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
                  })()})
                </span>
              </span>

              <button
                type="button"
                onClick={refreshDashboard}
                title="Refresh now"
                aria-label="Refresh dashboard"
                className="rounded p-0.5 transition hover:text-blue-600"
              >
                <RefreshCw className={["size-3", loading ? "animate-spin" : ""].join(" ")} />
              </button>

            </div>

          </div>
        </PageShell>
  );
}

/* ============================================================
   SIDEBAR
============================================================ */

/* ============================================================
   KPI CARD
============================================================ */

/* v1.5.3 — mask profanity in dashboard tables (org-facing surfaces) */
