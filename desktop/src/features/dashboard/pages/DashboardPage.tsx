import {
  Activity,
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Eye,
  Gauge,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  Ticket,
  Users,
} from "lucide-react";
import { EmptyState, ErrorState, PageHeader, PageShell } from "@/components/ui/page";

import { useEffect, useMemo, useState } from "react";

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

import type { Conversation, RecentTicket, Domain, HealthItem } from "@/features/dashboard/lib/dashboardTypes";
import { healthIcon, maskProfanity } from "@/features/dashboard/lib/dashboardUtils";
import { Legend, ConversationChart, DonutChart } from "@/features/dashboard/components/DashboardCharts";
import { KpiCard, DomainRow, HealthRow } from "@/features/dashboard/components/DashboardRows";
import { SectionHeader, ResultBadge, StatusBadge, PriorityBadge, DashboardReportButtons } from "@/features/dashboard/components/DashboardBits";

/**
 * Overview — what happened, what needs attention, and how trustworthy the answers are.
 *
 * v1.7.3 redesign. The previous page tried to fit six KPI tiles, three charts, a gate-trend
 * band and three tables into a single non-scrolling viewport. Every panel was therefore
 * squeezed to a fixed height, and the most actionable signal (a dependency is down, answers
 * are being cautioned, escalations are piling up) sat in the same visual weight as vanity
 * counters. This version is built around three questions, top to bottom:
 *
 *   1. Does anything need me right now?   → the attention strip (only real signals)
 *   2. How much work happened?            → KPI tiles with honest deltas
 *   3. Is the assistant working well?     → trend, answer quality, escalations, knowledge
 *
 * Every figure still comes from the seven /api/dashboard* endpoints. There are no sample
 * fallbacks: a failed load leaves "—" and an explicit banner, never a plausible-looking
 * zero. The page scrolls naturally instead of being forced into one screen, so nothing is
 * clipped at smaller heights.
 */

type Props = {
  userName?: string;
  role?: string;
};

export default function Dashboard({ role }: Props) {
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  // The COMMITTED reporting window is the state. The picker's controls are only ways to
  // set it, so opening the picker — or typing half a range — cannot change what is reported.
  const [win, setWin] = useState<ReportWindow>({ kind: "preset", days: 7 });
  // The date boxes hold a DRAFT; "Apply range" commits it into `win`.
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  // What the backend actually reported, so the footer names the real window rather than
  // repeating the request (the backend clamps a span it considers too long).
  const [windowEcho, setWindowEcho] = useState<{ start: string; end: string } | null>(null);

  // Real API data
  const [stats, setStats] = useState<any>(null);
  const [series, setSeries] = useState<{ day: string; total: number; resolved: number; escalated: number }[]>([]);
  const [domainsLive, setDomainsLive] = useState<Domain[] | null>(null);
  const [liveConversations, setLiveConversations] = useState<Conversation[] | null>(null);
  const [liveTickets, setLiveTickets] = useState<RecentTicket[] | null>(null);
  const [liveHealth, setLiveHealth] = useState<HealthItem[] | null>(null);
  const [gateTrend, setGateTrend] = useState<{ day: string; answered: number; cautioned: number }[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [healthSummary, setHealthSummary] = useState<{
    overall: string;
    down: string[];
    guardrailEvents: number;
  }>({ overall: "Healthy", down: [], guardrailEvents: 0 });

  // Poll every 60s so a dashboard left open does not show stale figures.
  const [nowTick, setNowTick] = useState(0);
  void nowTick;
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

  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      day: "2-digit", month: "short", year: "numeric",
    });

  const rangeLabel =
    win.kind === "custom"
      ? `${shortDate(win.start)} → ${shortDate(win.end)}`
      : `Last ${win.days} days`;

  const todayIso = new Date().toISOString().slice(0, 10);
  const customInvalid = !!customFrom && !!customTo && (customFrom > customTo || customFrom > todayIso);

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
        else setGateTrend([]);
        if (c?.series?.length) setSeries(c.series);
        else setSeries([]);
        if (c?.start && c?.end) setWindowEcho({ start: c.start, end: c.end });
        setDomainsLive(
          d?.domains?.length
            ? d.domains.map((x: { name: string; count: number; percentage: number }) => ({
                name: x.name, count: x.count, percentage: x.percentage,
              }))
            : [],
        );
        setLiveConversations(rc?.conversations ?? []);
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
          setLiveTickets(rt.tickets.map((t: any) => ({ ...t, status: norm(t.status), priority: prio(t.priority) })));
        } else {
          setLiveTickets([]);
        }
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
        } else {
          setLiveHealth([]);
        }
      } catch (err) {
        // No sample fallbacks: a failure surfaces as a banner plus "—" values, never zeroes.
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted) {
          setLoading(false);
          setLastUpdated(new Date());
        }
      }
    }

    load();
    return () => { mounted = false; };
  }, [refreshTick, win]);

  function refreshDashboard() {
    setLoading(true);
    setLastUpdated(new Date());
    setRefreshTick((v) => v + 1);
  }

  // ---- derived, honest insight figures -------------------------------------------
  const totals = useMemo(() => {
    const total = Number(stats?.total_conversations ?? 0);
    const resolved = Number(stats?.resolved_by_bot ?? 0);
    const escalated = Number(stats?.escalated_to_tickets ?? 0);
    const unresolved = Math.max(0, total - resolved - escalated);
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
    const gateAnswered = gateTrend.reduce((a, d) => a + (d.answered ?? 0), 0);
    const gateCautioned = gateTrend.reduce((a, d) => a + (d.cautioned ?? 0), 0);
    const gateTotal = gateAnswered + gateCautioned;
    return {
      total, resolved, escalated, unresolved,
      resolvedPct: pct(resolved),
      escalatedPct: pct(escalated),
      unresolvedPct: pct(unresolved),
      gateAnswered, gateCautioned, gateTotal,
      gatePassPct: gateTotal > 0 ? Math.round((gateAnswered / gateTotal) * 1000) / 10 : null,
      openTickets: (liveTickets ?? []).filter((t) => t.status === "Open").length,
    };
  }, [stats, gateTrend, liveTickets]);

  const needsReview = useMemo(() => {
    // Escalated/unresolved first: the point of the list is what still needs a human.
    const rank = (c: Conversation) => {
      const r = (c.result || "").toLowerCase();
      if (r.includes("escalat")) return 0;
      if (r.includes("caution") || r.includes("unresolved") || r.includes("no answer")) return 1;
      return 2;
    };
    const all = [...(liveConversations ?? [])].sort((a, b) => rank(a) - rank(b));
    const flagged = all.filter((c) => rank(c) < 2);
    // Nothing flagged → show the latest conversations rather than an empty panel; the
    // point of the panel is triage, and a clean queue is worth showing, not hiding.
    return (flagged.length ? flagged : all).slice(0, 5);
  }, [liveConversations]);

  const attention = useMemo(() => {
    const items: { key: string; tone: "danger" | "warn" | "ok"; title: string; detail: string }[] = [];
    if (healthSummary.down.length) {
      items.push({
        key: "deps",
        tone: "danger",
        title: "Dependency down",
        detail: `Failing: ${healthSummary.down.join(", ")}`,
      });
    }
    if (totals.gatePassPct !== null && totals.gatePassPct < 85) {
      items.push({
        key: "gate",
        tone: "warn",
        title: "Low-confidence answers",
        detail: `${totals.gateCautioned} cautioned · ${totals.gatePassPct}% passed the gate`,
      });
    }
    return items;
  }, [healthSummary, totals]);

  function deltaInfo(key: string, current: number): {
    change: string | null; positive: boolean; description: string;
  } {
    const d = (stats as any)?.deltas?.[key];
    const prev = (stats as any)?.previous?.[key];
    if (d == null || prev == null) {
      return {
        change: null,
        positive: true,
        // No comparison data → say nothing rather than repeating "no baseline" on
        // every tile. Honest silence beats decorative captions.
        description: prev === 0 && current > 0 ? "new this week" : "",
      };
    }
    if (prev < 10) return { change: null, positive: d >= 0, description: `up from ${prev} last week` };
    if (Math.abs(d) >= 300) {
      const mult = prev > 0 ? current / prev : 0;
      return { change: null, positive: d >= 0, description: `${mult.toFixed(1)}× last week` };
    }
    return {
      change: `${d >= 0 ? "+" : "−"}${Math.abs(d)}%`,
      positive: d >= 0,
      description: "vs previous 7 days",
    };
  }
  const deltaProps = (key: string, current: number) => deltaInfo(key, current);

  // Non-admins have five KPI tiles; at xl the sixth slot would sit empty, so the last
  // tile closes the row instead of leaving a hole.
  const kpiFillLast = role !== "admin";

  const noActivity =
    !loading && !loadError && stats === null && series.length === 0
    && !liveTickets?.length && !liveConversations?.length;

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={["Workspace", "Overview"]}
        eyebrow="Administration"
        icon={<Activity className="size-5" />}
        badge={role === "admin" ? "Administrator" : "User"}
        title="Workspace overview"
        description="Counters cover the last 7 days; the trend and confidence gate follow the range picker."
        actions={<>
          <div className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => setRangeOpen((v) => !v)}
              title="Reporting window"
              className={[
                "flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] bg-card px-2.5 text-2xs font-medium shadow-sm transition hover:bg-muted",
                win.kind === "custom" ? "border-[var(--primary)]/50 text-[var(--accent-foreground)]" : "",
              ].join(" ")}
            >
              <CalendarDays className="size-3.5" />
              {rangeLabel}
              <ChevronDown className={`size-3 text-muted-foreground transition ${rangeOpen ? "rotate-180" : ""}`} />
            </button>
            {rangeOpen && (
              <div className="absolute right-0 top-11 z-20 w-64 rounded-2xl border border-[var(--border)] bg-[var(--popover)] p-1.5 shadow-lg">
                {([7, 30, 90] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setWin((w) => (w.kind === "preset" && w.days === r ? w : { kind: "preset", days: r }));
                      setRangeOpen(false);
                    }}
                    className={[
                      "block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-muted",
                      win.kind === "preset" && win.days === r
                        ? "font-semibold text-[var(--accent-foreground)]"
                        : "text-foreground",
                    ].join(" ")}
                  >
                    Last {r} days
                  </button>
                ))}

                <div className="mt-1 border-t pt-1.5">
                  <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                        className="mt-0.5 h-7 w-full rounded-md border border-[var(--border)] bg-card px-2 text-xs"
                      />
                    </label>
                    <label className="block">
                      <span className="text-2xs font-medium text-muted-foreground">To</span>
                      <input
                        type="date"
                        value={customTo}
                        max={todayIso}
                        onChange={(e) => setCustomTo(e.target.value)}
                        className="mt-0.5 h-7 w-full rounded-md border border-[var(--border)] bg-card px-2 text-xs"
                      />
                    </label>

                    {customInvalid && (
                      <p className="text-2xs leading-tight text-destructive">
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
                      className="h-7 w-full rounded-md bg-primary text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
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

          <DashboardReportButtons
            stats={stats}
            conversations={liveConversations ?? []}
            tickets={liveTickets ?? []}
            domains={domainsLive ?? []}
          />
        </>}
      />

      <div className="flex flex-col gap-4 pb-2">
        {loadError && !loading && (
          <ErrorState
            banner
            title="Some dashboard data could not be loaded"
            detail={loadError}
            onRetry={refreshDashboard}
            retryLabel="Retry"
          />
        )}

        {noActivity ? (
          <EmptyState
            icon={<Activity className="size-5" />}
            title="No activity in this reporting window"
            description="Nothing has been recorded for the selected period. Try a wider range, or check that the chat and ticket integrations are connected in Settings."
            actionLabel="Widen to 90 days"
            onAction={() => setWin({ kind: "preset", days: 90 })}
          />
        ) : (
          <>
            {/* ---------------- 1. ATTENTION ---------------- */}
            <section data-section="attention" aria-label="Needs attention" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(attention.length > 0 || loading) && <div className="rounded-2xl border border-[var(--border)] bg-card p-4 text-card-foreground shadow-xs sm:col-span-2 xl:col-span-1">
                <div className="flex items-center gap-2">
                  <span className={[
                    "grid size-7 place-items-center rounded-lg",
                    attention.length ? "bg-[var(--warn)]/12 text-[var(--warn)]" : "bg-[var(--ok)]/12 text-[var(--ok)]",
                  ].join(" ")}>
                    {attention.length ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                  </span>
                  <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Needs attention</p>
                </div>
                <p className="mt-2 text-sm font-semibold leading-snug">
                  {loading ? "Checking…" : attention.length ? `${attention.length} signal${attention.length === 1 ? "" : "s"} to review` : "Nothing blocking right now"}
                </p>
                <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
                  {loading
                    ? "Reading live service and conversation data."
                    : attention.length
                      ? "Derived from failing dependencies, escalations, confidence gate and guardrails."
                      : "No failing dependency, no escalations and no guardrail events in this window."}
                </p>
              </div>}

              {(attention.length ? attention.slice(0, 3) : []).map((a) => (
                <div key={a.key} className="rounded-2xl border border-[var(--border)] bg-card p-4 shadow-xs">
                  <div className="flex items-start gap-2">
                    <span className={[
                      "mt-1 size-2 shrink-0 rounded-full",
                      a.tone === "danger" ? "bg-[var(--danger)]" : a.tone === "warn" ? "bg-[var(--warn)]" : "bg-[var(--ok)]",
                    ].join(" ")} />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">{a.title}</p>
                      <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{a.detail}</p>
                    </div>
                  </div>
                </div>
              ))}

              {attention.length === 0 && !loading && (
                <div className="rounded-2xl border border-[var(--border)] bg-card p-4 shadow-xs sm:col-span-2 xl:col-span-3">
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--ok)]/12 text-[var(--ok)]">
                      <CheckCircle2 className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">All clear</p>
                      <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
                        {(liveHealth ?? []).length} dependencies healthy · {totals.resolvedPct}% of conversations resolved without a human
                        {totals.gatePassPct === null ? "" : ` · ${totals.gatePassPct}% passed the confidence gate`}
                        {healthSummary.guardrailEvents > 0 ? ` · ${healthSummary.guardrailEvents} guardrail event${healthSummary.guardrailEvents === 1 ? "" : "s"}` : ""}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* ---------------- 2. WORK VOLUME ---------------- */}
            <section data-section="kpis" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
              <KpiCard
                icon={<MessageSquare className="size-4" />}
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
                className={kpiFillLast ? "col-span-2 xl:col-span-2" : undefined}
              />
              {role === "admin" && (
                <KpiCard
                  tone="rose"
                  icon={<ShieldAlert className="size-4" />}
                  value={stats ? String(stats.attacks_blocked_7d ?? 0) : "—"}
                  title="Attacks Blocked (7d)"
                  description="Injection + overflow · 7d"
                  loading={loading}
                />
              )}
            </section>

            {/* ---------------- 3. ACTION QUEUE ---------------- */}
            <section data-section="queue" className="grid gap-3 xl:grid-cols-3">
              {/* Needs review */}
              <Card className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] shadow-xs">
                <SectionHeader
                  title="Needs review"
                  pill={liveConversations ? String(needsReview.length) : undefined}
                />
                <div className="divide-y">
                  {needsReview.length === 0 && (
                    <p className="px-4 py-8 text-center text-2xs text-muted-foreground">
                      No conversations yet — data appears as users chat.
                    </p>
                  )}
                  {needsReview.map((conversation) => (
                    <div key={`${conversation.time}-${conversation.user}`} className="space-y-1 px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <ResultBadge result={conversation.result} />
                          <span className="truncate text-xs font-medium" title={conversation.user}>{conversation.user}</span>
                        </span>
                        <span className="shrink-0 text-2xs text-muted-foreground" title={conversation.time}>
                          {(() => {
                            const d = conversation.time
                              ? new Date(conversation.time.endsWith("Z") || conversation.time.includes("+") ? conversation.time : conversation.time + "Z")
                              : null;
                            return d && !Number.isNaN(d.getTime())
                              ? d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
                              : conversation.time;
                          })()}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground" title={maskProfanity(conversation.question)}>
                        {maskProfanity(conversation.question)}
                      </p>
                      <button
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent("ith:view-conversation", {
                            detail: { user: conversation.user, question: conversation.question },
                          }));
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium text-[var(--accent-foreground)] transition hover:bg-accent"
                      >
                        <Eye className="size-3.5" /> View
                      </button>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Tickets */}
              <Card className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] shadow-xs">
                <SectionHeader
                  title="Recent tickets"
                  pill={liveTickets ? `${totals.openTickets} open` : undefined}
                />
                <div className="divide-y">
                  {(liveTickets ?? []).length === 0 && (
                    <div className="px-4 py-8 text-center text-2xs text-muted-foreground">
                      No tickets yet — escalations will appear here.
                    </div>
                  )}
                  {(liveTickets ?? []).map((ticket) => (
                    <div key={ticket.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted/50">
                      <div className="w-14 shrink-0 text-2xs font-semibold text-[var(--accent-foreground)]">{ticket.id}</div>
                      <div className="min-w-0 flex-1 truncate text-xs font-medium">{ticket.subject}</div>
                      <StatusBadge status={ticket.status} />
                      <PriorityBadge priority={ticket.priority} />
                    </div>
                  ))}
                </div>
              </Card>

              {/* Knowledge */}
              <Card className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] shadow-xs">
                <SectionHeader
                  title="Knowledge by domain"
                  pill={stats?.kb_pages != null ? `${stats.kb_pages} articles` : undefined}
                />
                <div className="space-y-3 px-4 py-4">
                  {(domainsLive ?? []).length === 0 && (
                    <div className="py-4 text-center text-2xs text-muted-foreground">No domain data yet.</div>
                  )}
                  {(domainsLive ?? []).slice(0, 6).map((domain) => (
                    <DomainRow key={domain.name} domain={domain} />
                  ))}
                  {(domainsLive ?? []).length > 6 && (
                    <p className="text-2xs text-muted-foreground">+{(domainsLive ?? []).length - 6} more domains</p>
                  )}
                </div>
              </Card>
            </section>

            {/* ---------------- 4. QUALITY ---------------- */}
            <section data-section="quality" className="grid gap-3 xl:grid-cols-3">
              <Card className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] p-4 shadow-xs xl:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">Conversations over time</h2>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {win.kind === "custom" ? rangeLabel : `last ${win.days} days`} · split by what the assistant did with each conversation
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-2xs text-muted-foreground">
                    <Legend label="Total conversations" className="bg-[var(--primary)]" />
                    <Legend label="Resolved by Bot" className="bg-[var(--ok)]" />
                    <Legend label="Escalated" className="bg-[var(--warn)]" />
                  </div>
                </div>
                <ConversationChart data={series} />
              </Card>

              <Card className="flex flex-col gap-4 rounded-2xl border border-[var(--border)] p-4 shadow-xs">
                <div>
                  <h2 className="text-sm font-semibold">Answer quality</h2>
                  <p className="mt-0.5 text-2xs text-muted-foreground">How often the bot finished without a human</p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-4">
                  <DonutChart stats={stats} />
                  <div className="min-w-[120px] space-y-2.5">
                    {[
                      { label: "Resolved by bot", pct: totals.resolvedPct, cls: "bg-[var(--ok)]" },
                      { label: "Escalated to IT", pct: totals.escalatedPct, cls: "bg-[var(--warn)]" },
                      { label: "No action taken", pct: totals.unresolvedPct, cls: "bg-[var(--border)]" },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-3 text-2xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span className={`size-2 rounded-full ${row.cls}`} aria-hidden />
                          {row.label}
                        </span>
                        <span className="font-semibold tabular-nums">{stats ? `${row.pct}%` : "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Gauge className="size-3" /> Confidence gate
                    </p>
                    <span className="text-xs font-semibold tabular-nums">
                      {totals.gatePassPct === null ? "—" : `${totals.gatePassPct}%`}
                    </span>
                  </div>
                  <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                    {totals.gateTotal > 0
                      ? `${totals.gateAnswered} answered · ${totals.gateCautioned} cautioned`
                      : "No gated answers in this window."}
                  </p>
                  {gateTrend.length === 0 ? (
                    <p className="mt-2 text-2xs text-muted-foreground">No gate data yet</p>
                  ) : (
                    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-[var(--warn)]/35" aria-hidden>
                      <span className="h-full rounded-full bg-[var(--ok)]" style={{ width: `${totals.gatePassPct ?? 0}%` }} />
                    </div>
                  )}
                </div>
              </Card>
            </section>

            {/* ---------------- 5. HEALTH ---------------- */}
            <Card data-section="health" className="overflow-hidden rounded-2xl border border-[var(--border)] shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-3.5">
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
                      ? "bg-[var(--ok)]/12 text-[var(--ok)]"
                      : healthSummary.overall === "Down"
                        ? "bg-[var(--danger)]/12 text-[var(--danger)]"
                        : "bg-[var(--warn)]/12 text-[var(--warn)]",
                  ].join(" ")}>
                    <span aria-hidden className={[
                      "size-1.5 rounded-full",
                      healthSummary.overall === "Healthy" ? "bg-[var(--ok)]" : healthSummary.overall === "Down" ? "bg-[var(--danger)]" : "bg-[var(--warn)]",
                    ].join(" ")} />
                    {healthSummary.overall}
                  </span>
                  <a
                    href="http://10.10.10.18:3000/d/rag-platform-health"
                    target="_blank"
                    rel="noreferrer"
                    title="Open full observability in Grafana"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium text-[var(--accent-foreground)] transition hover:bg-accent"
                  >
                    <ExternalLink className="size-3" /> Grafana
                  </a>
                </div>
              </div>

              <div className="grid gap-0 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
                {(liveHealth ?? []).length === 0 && (
                  <div className="px-4 py-6 text-center text-2xs text-muted-foreground">
                    Health data unavailable.
                  </div>
                )}
                {(liveHealth ?? []).map((item) => (
                  <div key={item.key ?? item.name} className="border-t border-[var(--border)]">
                    <HealthRow item={item} />
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 border-t border-[var(--border)] bg-muted/60 px-5 py-2.5">
                <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--warn)]/12 text-[var(--warn)]">
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
            </Card>
          </>
        )}

        {/* ---------------- FOOTER ---------------- */}
        <div className="flex flex-col items-center justify-center gap-2 pt-1 text-3xs text-muted-foreground sm:flex-row">
          <span title={windowEcho ? `${shortDate(windowEcho.start)} → ${shortDate(windowEcho.end)}` : rangeLabel}>
            {windowEcho ? `${shortDate(windowEcho.start)} → ${shortDate(windowEcho.end)}` : rangeLabel}
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
            className="rounded p-0.5 transition hover:text-[var(--accent-foreground)]"
          >
            <RefreshCw className={["size-3", loading ? "animate-spin" : ""].join(" ")} />
          </button>
        </div>
      </div>
    </PageShell>
  );
}
