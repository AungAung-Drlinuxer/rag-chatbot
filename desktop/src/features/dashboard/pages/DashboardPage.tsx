import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Eye,
  MessageSquare,
  RefreshCw,
  Ticket,
  Users,
  XCircle,
} from "lucide-react";
import { PageShell, PageHeader } from "@/components/ui/page";

import { useEffect, useState, type ReactNode } from "react";

import {
  dashStats,
  dashConversations,
  dashDomains,
  dashRecentConversations,
  dashRecentTickets,
  dashHealth,
} from "@/features/dashboard/api";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/* ============================================================
   TYPES
============================================================ */

type Props = {
  userName?: string;
  role?: string;
  onNavigate?: (page: string) => void;
};

type Conversation = {
  time: string;
  user: string;
  question: string;
  result: "Resolved" | "Escalated";
};

type RecentTicket = {
  id: string;
  subject: string;
  status: "Open" | "Pending" | "Resolved";
  priority: "Critical" | "High" | "Medium" | "Low";
};

type Domain = {
  name: string;
  count: number;
  percentage: number;
  icon: ReactNode;
};

type HealthItem = {
  name: string;
  status: "Healthy" | "Degraded" | "Down";
  icon: ReactNode;
};

/* ============================================================
   SAMPLE DATA
   Replace these with API data later.
============================================================ */


/* ============================================================
   MAIN DASHBOARD
============================================================ */

export default function Dashboard({ role }: Props) {
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] =
    useState(new Date());
  const [range, setRange] = useState<"7d" | "30d" | "90d">("7d");
  const [rangeOpen, setRangeOpen] = useState(false);

  // Real API data (v0.12.0)
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [series, setSeries] = useState<{ day: string; total: number; resolved: number; escalated: number }[]>([]);
  const [domainsLive, setDomainsLive] = useState<Domain[] | null>(null);
  const [liveConversations, setLiveConversations] = useState<Conversation[] | null>(null);
  const [liveTickets, setLiveTickets] = useState<RecentTicket[] | null>(null);
  const [liveHealth, setLiveHealth] = useState<HealthItem[] | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const [s, c, d, rc, rt, h] = await Promise.all([
          dashStats(),
          dashConversations(7),
          dashDomains(),
          dashRecentConversations(6),
          dashRecentTickets(5),
          dashHealth(),
        ]);
        if (!mounted) return;
        setStats(s ?? null);
        if (c?.series?.length) setSeries(c.series);
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
        if (h?.length) {
          setLiveHealth(h.map((x: { name: string; status: string }) => ({
            name: x.name,
            status: (x.status === "Healthy" ? "Healthy" : "Down") as HealthItem["status"],
            icon: <Activity className="size-4" />,
          })));
        }
      } catch {
        // keep sample fallbacks on failure
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [refreshTick]);

  function refreshDashboard() {
    setLoading(true);
    setLastUpdated(new Date());
    setRefreshTick((v) => v + 1);
  }

    return (
    <PageShell>
      <PageHeader
      icon={<Activity className="size-5" />}
      badge={role === "admin" ? "Administrator" : "User"}
      title="Dashboard"
      description="Overview of IT Help Chatbot and system activity"
      actions={<>
        <DashboardReportButtons stats={stats} conversations={liveConversations ?? []} tickets={liveTickets ?? []} domains={domainsLive ?? []} />
        <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={refreshDashboard}
              >
                <RefreshCw
                  className={[
                    "mr-2 size-3.5",
                    loading
                      ? "animate-spin"
                      : "",
                  ].join(" ")}
                />

                Refresh
              </Button>

              <div className="relative hidden sm:block">
                <button
                  type="button"
                  onClick={() => setRangeOpen((v) => !v)}
                  className="flex h-9 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-medium hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <CalendarDays className="size-3.5" />
                  {range === "7d" ? "Last 7 days" : range === "30d" ? "Last 30 days" : "Last 90 days"}
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </button>
                {rangeOpen && (
                  <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border bg-white p-1 shadow-lg dark:bg-slate-900">
                    {(["7d", "30d", "90d"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => { setRange(r); setRangeOpen(false); }}
                        className={[
                          "block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800",
                          r === range ? "font-semibold text-blue-600" : "text-slate-700 dark:text-slate-200",
                        ].join(" ")}
                      >
                        {r === "7d" ? "Last 7 days" : r === "30d" ? "Last 30 days" : "Last 90 days"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
      </>}
    />

          {/* =================================================
              CONTENT
          ================================================= */}

          <div className="mx-auto max-w-[1400px] space-y-5 p-5 lg:p-8">

            {/* KPI */}

            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">

              <KpiCard
                icon={
                  <MessageSquare className="size-4" />
                }
                value={stats ? String(stats.total_conversations) : "—"}
                title="Total Conversations"
                change="+18.6%"
                positive
                description="vs last 7 days"
                loading={loading}
              />

              <KpiCard
                icon={
                  <CheckCircle2 className="size-4" />
                }
                value={stats ? String(stats.resolved_by_bot) : "—"}
                title="Resolved by Bot"
                change="+22.4%"
                positive
                description="vs last 7 days"
                loading={loading}
              />

              <KpiCard
                icon={
                  <Ticket className="size-4" />
                }
                value={stats ? String(stats.escalated_to_tickets) : "—"}
                title="Escalated to Tickets"
                change="−8.3%"
                positive
                description="vs last 7 days"
                loading={loading}
              />

              <KpiCard
                icon={<Users className="size-4" />}
                value={stats ? String(stats.active_users) : "—"}
                title="Active Users"
                change="+12.7%"
                positive
                description="vs last 7 days"
                loading={loading}
              />

            </section>

            {/* =================================================
                CHART ROW
            ================================================= */}

            <section className="grid gap-4 xl:grid-cols-[1.7fr_1fr_1.25fr]">

              {/* Conversations */}

              <Card className="rounded-2xl p-5">

                <div className="flex items-start justify-between">

                  <div>
                    <h2 className="text-sm font-semibold">
                      Conversations over time
                    </h2>

                    <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">

                      <Legend
                        label="Total"
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

                  <button className="flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[10px] font-medium">
                    7 Days
                    <ChevronDown className="size-3" />
                  </button>

                </div>

                <ConversationChart data={series} />

              </Card>

              {/* Escalation */}

              <Card className="rounded-2xl p-5">

                <h2 className="text-sm font-semibold">
                  Escalation rate
                </h2>

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
                          label="Resolved by Bot"
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
                          label="Others / No action"
                          value={stats ? String(oth) : "—"}
                          percentage={pc(oth)}
                        />
                      </>
                    );
                  })()}

                </div>

              </Card>

              {/* Domains */}

              <Card className="rounded-2xl p-5">

                <h2 className="text-sm font-semibold">
                  Top domains
                </h2>

                <div className="mt-5 space-y-4">

                  {(domainsLive ?? []).length === 0 && (
                    <div className="px-4 py-6 text-center text-[10px] text-muted-foreground">
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
                LOWER ROW
            ================================================= */}

            <section className="grid gap-4 xl:grid-cols-[1.2fr_1.1fr_1fr]">

              {/* Recent conversations */}

              <Card className="overflow-hidden rounded-2xl">

                <SectionHeader
                  title="Recent conversations"
                                  />

                <div className="max-h-[360px] overflow-y-auto overflow-x-hidden">

                  <table className="w-full table-fixed text-xs">

                    <colgroup>

                      <col className="w-[14%]" />

                      <col className="w-[14%]" />

                      <col className="w-[40%]" />

                      <col className="w-[12%]" />

                      <col className="w-[20%]" />

                    </colgroup>

                    <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">

                      <tr className="text-left text-[10px] text-muted-foreground">

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
                          <td colSpan={4} className="px-4 py-8 text-center text-[10px] text-muted-foreground">
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

                            <td className="whitespace-nowrap px-4 py-3 text-[10px] text-muted-foreground" title={conversation.time}>
                              {(() => {
                                const d = conversation.time ? new Date(conversation.time.endsWith("Z") || conversation.time.includes("+") ? conversation.time : conversation.time + "Z") : null;
                                return d && !Number.isNaN(d.getTime())
                                  ? d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
                                  : conversation.time;
                              })()}
                            </td>

                            <td className="max-w-[120px] truncate px-4 py-3 text-[10px] font-medium" title={conversation.user}>
                              {conversation.user}
                            </td>

                            <td className="max-w-[190px] truncate px-4 py-3 text-[10px]">
                              {conversation.question}
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
                                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
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

              <Card className="overflow-hidden rounded-2xl">

                <SectionHeader
                  title="Recent tickets"
                                  />

                <div className="max-h-[360px] divide-y overflow-y-auto">

                  {(liveTickets ?? []).length === 0 && (
                    <div className="px-4 py-8 text-center text-[10px] text-muted-foreground">
                      No tickets yet — escalations will appear here.
                    </div>
                  )}

                  {(liveTickets ?? []).map((ticket) => (
                    <div
                      key={ticket.id}
                      className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-slate-50 dark:hover:bg-slate-900/50"
                    >

                      <div className="w-14 shrink-0 text-[10px] font-semibold text-blue-600">
                        {ticket.id}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-medium">
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

              <Card className="overflow-hidden rounded-2xl">

                <div className="flex items-center justify-between border-b px-5 py-4">

                  <h2 className="text-sm font-semibold">
                    System health
                  </h2>

                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    All systems operational
                  </span>

                </div>

                <div className="divide-y">

                  {(liveHealth ?? []).length === 0 && (
                    <div className="px-4 py-6 text-center text-[10px] text-muted-foreground">
                      Health data unavailable.
                    </div>
                  )}

                  {(liveHealth ?? []).map((item) => (
                    <HealthRow
                      key={item.name}
                      item={item}
                    />
                  ))}

                </div>

              </Card>

            </section>

            {/* =================================================
                FOOTER
            ================================================= */}

            <div className="flex flex-col items-center justify-center gap-2 py-1 text-[10px] text-muted-foreground sm:flex-row">

              <span>
                All times are shown in Asia/Bangkok (GMT+7)
              </span>

              <span className="hidden sm:block">
                |
              </span>

              <span>
                Last updated:{" "}
                {lastUpdated.toLocaleTimeString(
                  "en-US",
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                  }
                )}
              </span>

              <RefreshCw className="size-3" />

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

function KpiCard({
  icon,
  value,
  title,
  change,
  description,
  positive,
  loading,
}: {
  icon: ReactNode;
  value: string;
  title: string;
  change: string;
  description: string;
  positive: boolean;
  loading: boolean;
}) {
  return (
    <Card className="relative overflow-hidden rounded-2xl p-4">

      <div className="flex items-start justify-between">

        <div>

          <div className="text-2xl font-semibold tracking-tight">
            {loading ? (
              <div className="h-7 w-20 animate-pulse rounded bg-muted" />
            ) : (
              value
            )}
          </div>

          <div className="mt-1 text-xs font-medium">
            {title}
          </div>

          <div className="mt-2 flex items-center gap-1.5 text-[10px]">

            {positive ? (
              <ArrowUpRight className="size-3 text-emerald-600" />
            ) : (
              <ArrowDownRight className="size-3 text-red-600" />
            )}

            <span
              className={
                positive
                  ? "font-medium text-emerald-600"
                  : "font-medium text-red-600"
              }
            >
              {change}
            </span>

            <span className="text-muted-foreground">
              {description}
            </span>

          </div>

        </div>

        <div className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300">
          {icon}
        </div>

      </div>

      {/* Small decorative chart */}

      <div className="absolute bottom-4 right-4 opacity-90">
        <MiniSparkline />
      </div>

    </Card>
  );
}

/* ============================================================
   SPARKLINE
============================================================ */

function MiniSparkline() {
  return (
    <svg
      width="65"
      height="34"
      viewBox="0 0 65 34"
      fill="none"
      className="text-blue-500"
    >
      <path
        d="M2 28 L12 23 L20 25 L29 14 L38 19 L47 8 L55 14 L63 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ============================================================
   LEGEND
============================================================ */

function Legend({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`h-0.5 w-3.5 rounded-full ${className}`}
      />

      {label}
    </span>
  );
}

/* ============================================================
   CONVERSATION CHART
============================================================ */

function ConversationChart({
  data,
}: {
  data: { day: string; total: number; resolved: number; escalated: number }[];
}) {
  // v0.21.84 — dynamic Y scale (was hardcoded 400): nearest "nice" ceiling
  const dataMax = Math.max(10, ...data.flatMap((d) => [d.total, d.resolved, d.escalated]));
  const step = Math.max(1, Math.pow(10, Math.floor(Math.log10(dataMax))));
  const max = Math.ceil((dataMax * 1.15) / step) * step;

  const width = 620;
  const height = 240;

  const left = 40;
  const right = 15;
  const top = 15;
  const bottom = 35;

  const chartWidth =
    width - left - right;

  const chartHeight =
    height - top - bottom;

  function points(key: "total" | "resolved" | "escalated") {
    return data
      .map((item, index) => {
        const x =
          left +
          (index /
            (data.length - 1)) *
            chartWidth;

        const y =
          top +
          chartHeight -
          (item[key] / max) * chartHeight;

        return `${x},${y}`;
      })
      .join(" ");
  }

  return (
    <div className="mt-3 w-full overflow-hidden">

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[260px] w-full"
        preserveAspectRatio="none"
      >

        {/* Grid */}

        {[0, 0.25, 0.5, 0.75, 1].map(
          (frac) => {
            const value = Math.round(max * frac);
            const y =
              top +
              chartHeight -
              (value / max) *
                chartHeight;

            return (
              <g key={value}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className="text-slate-100 dark:text-slate-800"
                />

                <text
                  x="5"
                  y={y + 3}
                  fontSize="10"
                  className="fill-slate-400"
                >
                  {value}
                </text>
              </g>
            );
          }
        )}

        {/* Total */}

        <polyline
          points={points("total")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-blue-500"
        />

        {/* Resolved */}

        <polyline
          points={points("resolved")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-emerald-500"
        />

        {/* Escalated */}

        <polyline
          points={points("escalated")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-orange-500"
        />

        {/* Points */}

        {data.map(
          (item, index) => {
            const x =
              left +
              (index /
                (data.length - 1)) *
                chartWidth;

            const y =
              top +
              chartHeight -
              (item.total / max) *
                chartHeight;

            return (
              <circle
                key={item.day}
                cx={x}
                cy={y}
                r="3"
                className="fill-blue-500"
              />
            );
          }
        )}

        {/* X labels */}

        {data.map(
          (item, index) => {
            const x =
              left +
              (index /
                (data.length - 1)) *
                chartWidth;

            return (
              <text
                key={item.day}
                x={x}
                y={height - 10}
                textAnchor="middle"
                fontSize="10"
                className="fill-slate-400"
              >
                {item.day}
              </text>
            );
          }
        )}

      </svg>

    </div>
  );
}

/* ============================================================
   DONUT
============================================================ */

function DonutChart({ stats }: { stats: Record<string, number> | null }) {
  const circumference = 2 * Math.PI * 70;

  // v0.21.84 — real escalation rate instead of a hardcoded mock
  const total = stats?.total_conversations ?? 0;
  const escalated = stats?.escalated_to_tickets ?? 0;
  const percentage = total > 0 ? Math.min(100, Math.round((escalated / total) * 1000) / 10) : 0;

  const dash =
    (percentage / 100) *
    circumference;

  return (
    <div className="relative size-44">

      <svg
        viewBox="0 0 180 180"
        className="-rotate-90"
      >

        <circle
          cx="90"
          cy="90"
          r="70"
          stroke="currentColor"
          strokeWidth="16"
          fill="none"
          className="text-slate-200 dark:text-slate-800"
        />

        <circle
          cx="90"
          cy="90"
          r="70"
          stroke="currentColor"
          strokeWidth="16"
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="butt"
          className="text-orange-500"
        />

      </svg>

      <div className="absolute inset-0 grid place-items-center text-center">

        <div>
          <div className="text-2xl font-semibold">
            {percentage}%
          </div>

          <div className="text-[10px] text-muted-foreground">
            Escalation Rate
          </div>
        </div>

      </div>

    </div>
  );
}

/* ============================================================
   ESCALATION ROW
============================================================ */

function EscalationRow({
  color,
  label,
  value,
  percentage,
}: {
  color: string;
  label: string;
  value: string;
  percentage: string;
}) {
  return (
    <div className="flex items-center justify-between text-[10px]">

      <div className="flex items-center gap-2">
        <span
          className={`size-2 rounded-full ${color}`}
        />

        <span className="text-muted-foreground">
          {label}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="font-medium">
          {value}
        </span>

        <span className="text-muted-foreground">
          ({percentage})
        </span>
      </div>

    </div>
  );
}

/* ============================================================
   DOMAIN ROW
============================================================ */

function DomainRow({
  domain,
}: {
  domain: Domain;
}) {
  return (
    <div className="flex items-center gap-3">

      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        {domain.icon}
      </div>

      <div className="min-w-0 flex-1">

        <div className="mb-1.5 flex items-center justify-between">

          <span className="text-[10px] font-medium">
            {domain.name}
          </span>

          <div className="flex items-center gap-2">

            <span className="text-[10px] font-medium">
              {domain.count}
            </span>

            <span className="w-10 text-right text-[10px] text-muted-foreground">
              {domain.percentage}%
            </span>

          </div>

        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">

          <div
            className="h-full rounded-full bg-blue-500"
            style={{
              width: `${domain.percentage * 4}%`,
            }}
          />

        </div>

      </div>

    </div>
  );
}

/* ============================================================
   SECTION HEADER
============================================================ */

/* v0.21.64 — Dashboard report: CSV export + printable summary (like Tickets page) */
function dashboardCsv(stats: any, conversations: any[], tickets: any[], domains: any[]): string {
  const lines: string[] = [];
  const stamp = new Date().toISOString().slice(0, 10);
  lines.push(`IT Help Chatbot - Dashboard Report,${stamp}`);
  lines.push("");
  lines.push("SUMMARY");
  lines.push("Metric,Value");
  if (stats) {
    lines.push(`Total questions,${stats.total ?? ""}`);
    lines.push(`Answered from KB,${stats.answered ?? ""}`);
    lines.push(`Escalated to tickets,${stats.escalated_to_tickets ?? ""}`);
    lines.push(`Avg confidence,${stats.avg_confidence ?? ""}`);
  }
  lines.push("");
  lines.push("DOMAIN BREAKDOWN");
  lines.push("Domain,Count,Percentage");
  (domains ?? []).forEach((d) => lines.push(`"${d.name}",${d.count},${d.percentage}%`));
  lines.push("");
  lines.push("RECENT TICKETS");
  lines.push("Ticket,Subject,Status,Priority");
  (tickets ?? []).forEach((t) => lines.push(`"${t.id}","${String(t.subject).replace(/"/g, '""')}",${t.status},${t.priority}`));
  lines.push("");
  lines.push("RECENT CONVERSATIONS");
  lines.push("Time,User,Question,Result");
  (conversations ?? []).forEach((c) =>
    lines.push(`${c.time},"${c.user}","${String(c.question).replace(/"/g, '""')}",${c.result}`));
  return lines.join("\n");
}

function DashboardReportButtons({ stats, conversations, tickets, domains }: {
  stats: any; conversations: any[]; tickets: any[]; domains: any[];
}) {
  function exportCsv() {
    const body = dashboardCsv(stats, conversations, tickets, domains);
    const blob = new Blob(["\ufeff" + body], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rows = (tickets ?? []).map((t) =>
      `<tr><td>${esc(t.id)}</td><td>${esc(t.subject)}</td><td>${esc(t.status)}</td><td>${esc(t.priority)}</td></tr>`).join("");
    const convRows = (conversations ?? []).map((c) =>
      `<tr><td>${esc(c.time)}</td><td>${esc(c.user)}</td><td>${esc(c.question)}</td><td>${esc(c.result)}</td></tr>`).join("");
    const domRows = (domains ?? []).map((d) =>
      `<tr><td>${esc(d.name)}</td><td>${esc(d.count)}</td><td>${esc(d.percentage)}%</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>Dashboard Report</title><style>
      body{font-family:Arial,sans-serif;margin:32px;color:#0f172a}
      h1{font-size:18px;margin:0 0 4px}.meta{font-size:12px;color:#64748b;margin-bottom:16px}
      h2{font-size:14px;margin:20px 0 6px}
      table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:12px}
      th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
      th{background:#f1f5f9}tr:nth-child(even) td{background:#f8fafc}
      .kpis{display:flex;gap:16px;font-size:13px}
      .kpi{border:1px solid #cbd5e1;border-radius:8px;padding:8px 14px}
      @media print{button{display:none}}
    </style></head><body>
      <h1>IT Help Chatbot — Dashboard Report</h1>
      <div class="meta">Generated ${new Date().toLocaleString()}</div>
      ${stats ? `<div class="kpis">
        <div class="kpi"><b>${esc(stats.total ?? "—")}</b><br>Total questions</div>
        <div class="kpi"><b>${esc(stats.answered ?? "—")}</b><br>Answered from KB</div>
        <div class="kpi"><b>${esc(stats.escalated_to_tickets ?? "—")}</b><br>Escalated</div>
        <div class="kpi"><b>${esc(stats.avg_confidence ?? "—")}</b><br>Avg confidence</div>
      </div>` : ""}
      <h2>Domain Breakdown</h2>
      <table><thead><tr><th>Domain</th><th>Count</th><th>Share</th></tr></thead><tbody>${domRows}</tbody></table>
      <h2>Recent Tickets</h2>
      <table><thead><tr><th>Ticket</th><th>Subject</th><th>Status</th><th>Priority</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>Recent Conversations</h2>
      <table><thead><tr><th>Time</th><th>User</th><th>Question</th><th>Result</th></tr></thead><tbody>${convRows}</tbody></table>
      <script>window.onload=function(){window.print()}<\/script>
    </body></html>`);
    w.document.close();
  }

  return (
    <>
      <Button variant="outline" size="sm" className="rounded-xl" onClick={exportCsv}>
        Export CSV
      </Button>
      <Button size="sm" className="rounded-xl bg-sky-700 hover:bg-sky-600" onClick={printReport}>
        Report
      </Button>
    </>
  );
}


function SectionHeader({
  title,
  action,
  href,
}: {
  title: string;
  action?: string;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b px-5 py-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {action && href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 hover:underline"
        >
          {action}
          <ArrowUpRight className="size-3" />
        </a>
      )}
    </div>
  );
}


/* ============================================================
   RESULT BADGE
============================================================ */

function ResultBadge({
  result,
}: {
  result: Conversation["result"];
}) {
  const resolved =
    result === "Resolved";

  return (
    <Badge
      variant="outline"
      className={
        resolved
          ? "rounded-md border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
          : "rounded-md border-orange-200 bg-orange-50 text-[10px] text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300"
      }
    >
      {result}
    </Badge>
  );
}

/* ============================================================
   STATUS BADGE
============================================================ */

function StatusBadge({
  status,
}: {
  status: RecentTicket["status"];
}) {
  const styles = {
    Open:
      "border-blue-200 bg-blue-50 text-blue-700",
    Pending:
      "border-amber-200 bg-amber-50 text-amber-700",
    Resolved:
      "border-emerald-200 bg-emerald-50 text-emerald-700",
  };

  return (
    <Badge
      variant="outline"
      className={`rounded-md text-[10px] ${styles[status]}`}
    >
      {status}
    </Badge>
  );
}

/* ============================================================
   PRIORITY
============================================================ */

function PriorityBadge({
  priority,
}: {
  priority: RecentTicket["priority"];
}) {
  const styles = {
    Critical: "bg-red-500",
    High: "bg-orange-500",
    Medium: "bg-amber-500",
    Low: "bg-emerald-500",
  };

  return (
    <span className="flex w-16 shrink-0 items-center gap-1.5 text-[10px]">

      <span
        className={`size-1.5 rounded-full ${styles[priority]}`}
      />

      {priority}

    </span>
  );
}

/* ============================================================
   HEALTH ROW
============================================================ */

function HealthRow({
  item,
}: {
  item: HealthItem;
}) {
  const healthy =
    item.status === "Healthy";

  return (
    <div className="flex items-center gap-3 px-5 py-3.5">

      <div className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">
        {item.icon}
      </div>

      <span className="flex-1 text-[10px] font-medium">
        {item.name}
      </span>

      <div className="flex items-center gap-1.5">

        {healthy ? (
          <CheckCircle2 className="size-3.5 text-emerald-500" />
        ) : (
          <XCircle className="size-3.5 text-red-500" />
        )}

        <span
          className={
            healthy
              ? "text-[10px] text-emerald-600"
              : "text-[10px] text-red-600"
          }
        >
          {item.status}
        </span>

      </div>

    </div>
  );
}
