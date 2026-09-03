/** Tickets feature presentational components — pure, no state, no fetch. */
import { type ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function StatCard({
  icon,
  label,
  value,
  description,
  accent = "slate",
}: {
  icon: ReactNode;
  label: string;
  value: number;
  description: string;
  accent?: "slate" | "blue" | "amber" | "emerald";
}) {
  const colors = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-900",
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/30",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/30",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30",
  };

  return (
    <Card className="rounded-2xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-medium text-muted-foreground">
            {label}
          </div>

          <div className="mt-2 text-2xl font-semibold tracking-tight">
            {value}
          </div>

          <div className="mt-1 text-[10px] text-muted-foreground">
            {description}
          </div>
        </div>

        <div
          className={[
            "grid size-9 place-items-center rounded-xl",
            colors[accent],
          ].join(" ")}
        >
          {icon}
        </div>
      </div>
    </Card>
  );
}

export function MetaRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>

      <div className="text-xs font-medium">{value}</div>
    </div>
  );
}

export function StatusBadge({
  status,
}: {
  status: { label: string; className: string };
}) {
  const meta = status;

  return (
    <Badge
      variant="outline"
      className={["rounded-lg text-[9px]", meta.className].join(" ")}
    >
      {meta.label}
    </Badge>
  );
}

export function PriorityBadge({
  priority,
}: {
  priority: { label: string; className: string; dot: string };
}) {
  const meta = priority;

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 text-xs font-medium",
        meta.className,
      ].join(" ")}
    >
      <span className={["size-2 rounded-full", meta.dot].join(" ")} />

      {meta.label}
    </span>
  );
}

export function ActivityItem({
  title,
  text,
  time,
}: {
  title: string;
  text: string;
  time: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500" />

      <div className="flex-1 rounded-xl bg-muted/40 px-3 py-2.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium">
            {title}
          </span>

          <span className="text-[10px] text-muted-foreground">
            {time}
          </span>
        </div>

        <div className="mt-1 text-[11px] text-muted-foreground">
          {text}
        </div>
      </div>
    </div>
  );
}

export function RefreshIcon({ className = "mr-2 size-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" />
    </svg>
  );
}
