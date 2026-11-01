/**
 * DashboardRows.tsx — extracted from DashboardPage.
 *
 * The KPI tiles and the list rows.
 */

import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Domain, HealthItem } from "@/features/dashboard/lib/dashboardTypes";
import type { ReactNode } from "react";

/**
 * One figure per KPI card, read top to bottom: muted label, big number, caption.
 *
 * The workspace mockup draws no icon tile and no sparkline on these cards, so neither is
 * rendered — the figure is the whole card. `icon` and `tone` stay in the props (callers
 * still pass them) so the component's public shape is unchanged, but nothing decorative
 * is drawn from them any more.
 */
export function KpiCard({
  value,
  title,
  change,
  description,
  positive,
  loading,
  className,
}: {
  icon?: ReactNode;
  value: string;
  title: string;
  change?: string | null;
  description: string;
  positive?: boolean;
  loading: boolean;
  tone?: "sky" | "emerald" | "orange" | "violet" | "rose";
  /** grid placement — used to close an odd KPI row */
  className?: string;
}) {
  return (
    <Card className={["gap-0 rounded-xl border-[var(--border)] px-5 py-4 shadow-xs", className ?? ""].join(" ")}>

      <div className="text-xs font-medium text-muted-foreground">
        {title}
      </div>

      <div className="mt-2.5 text-3xl font-semibold tracking-tight">
        {loading ? (
          <div className="h-8 w-16 animate-pulse rounded bg-muted" />
        ) : (
          value
        )}
      </div>

      <div className="mt-1 flex items-center gap-1.5 text-2xs">

        {change != null && (
          positive ? (
            <ArrowUpRight className="size-3 text-emerald-600" />
          ) : (
            <ArrowDownRight className="size-3 text-red-600" />
          )
        )}

        {change != null && (
          <span
            className={
              positive
                ? "font-medium text-emerald-600"
                : "font-medium text-red-600"
            }
          >
            {change}
          </span>
        )}

        <span className="text-muted-foreground">
          {description}
        </span>

      </div>

    </Card>
  );
}

/* ============================================================
   SPARKLINE
============================================================ */

export function EscalationRow({
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
    <div className="flex items-center justify-between text-2xs">

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

export function DomainRow({
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

          <span className="text-2xs font-medium">
            {domain.name}
          </span>

          <div className="flex items-center gap-2">

            <span className="text-2xs font-medium">
              {domain.count}
            </span>

            <span className="w-10 text-right text-2xs text-muted-foreground">
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

export function HealthRow({ item }: { item: HealthItem }) {
  const healthy = item.status === "Healthy";

  return (
    // #13 — rows were size-8/py-3.5 for eight services (~560px panel). Compacted to
    // size-7/py-2 with the failure reason inline so a red row explains itself.
    <div className="flex items-center gap-3 px-5 py-2">
      <div
        className={[
          "grid size-7 shrink-0 place-items-center rounded-lg",
          healthy
            ? "bg-muted text-muted-foreground"
            : "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
        ].join(" ")}
      >
        {item.icon}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-2xs font-medium leading-tight">{item.name}</div>
        {!healthy && item.detail && (
          <div className="mt-0.5 truncate text-2xs leading-tight text-rose-600/90 dark:text-rose-400/90" title={item.detail}>
            {item.detail}
          </div>
        )}
      </div>

      {healthy && item.latency_ms != null && (
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {item.latency_ms}ms
        </span>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        {healthy ? (
          <CheckCircle2 className="size-3.5 text-emerald-500" />
        ) : (
          <XCircle className="size-3.5 text-red-500" />
        )}
        <span className={healthy ? "text-2xs text-emerald-600" : "text-2xs text-red-600"}>
          {item.status}
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   GATE TREND CHART (v1.1.6)
============================================================ */
