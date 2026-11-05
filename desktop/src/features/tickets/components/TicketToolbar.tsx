/**
 * Queue toolbar: one search field, two filters, and the filter state made visible.
 *
 * The controls are a single aligned row on desktop and stack in a predictable order on
 * mobile (search first — it is the most used). Once a filter is applied it is repeated as a
 * removable chip underneath, so a user who narrowed the list can always see *why* the table
 * is showing four rows, and clear exactly the one that is wrong.
 */
import { ChevronDown, Filter, ListFilter, Search, X } from "lucide-react";

export type TicketFilters = { query: string; status: string; priority: string };

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
  closed: "Closed",
};

const PRIORITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function Select({
  value,
  onChange,
  label,
  icon,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-w-0">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-9 w-full appearance-none rounded-lg border border-[var(--border)] bg-background pl-8 pr-8 text-xs outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </div>
  );
}

export function TicketToolbar({
  filters,
  onChange,
  onReset,
}: {
  filters: TicketFilters;
  onChange: (patch: Partial<TicketFilters>) => void;
  onReset: () => void;
}) {
  const q = filters.query.trim();
  const hasFilters = q !== "" || filters.status !== "all" || filters.priority !== "all";

  const chips: { key: keyof TicketFilters; label: string; clear: Partial<TicketFilters> }[] = [];
  if (q) chips.push({ key: "query", label: `“${q}”`, clear: { query: "" } });
  if (filters.status !== "all") {
    chips.push({ key: "status", label: `Status: ${STATUS_LABEL[filters.status] ?? filters.status}`, clear: { status: "all" } });
  }
  if (filters.priority !== "all") {
    chips.push({ key: "priority", label: `Priority: ${PRIORITY_LABEL[filters.priority] ?? filters.priority}`, clear: { priority: "all" } });
  }

  return (
    <div className="border-y border-[var(--border)] bg-muted/15 px-4 py-3 sm:px-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        {/* Search */}
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={filters.query}
            onChange={(e) => onChange({ query: e.target.value })}
            placeholder="Search ID, subject, requester or assignee…"
            aria-label="Search tickets"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-background pl-9 pr-9 text-xs outline-none transition placeholder:text-muted-foreground/80 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => onChange({ query: "" })}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>

        {/* Filters: side by side on mobile too — they are short enough to share a row. */}
        <div className="grid grid-cols-2 gap-2 md:flex md:w-auto md:shrink-0">
          <Select
            value={filters.status}
            onChange={(v) => onChange({ status: v })}
            label="Filter by status"
            icon={<Filter className="size-3.5" />}
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </Select>

          <Select
            value={filters.priority}
            onChange={(v) => onChange({ priority: v })}
            label="Filter by priority"
            icon={<ListFilter className="size-3.5" />}
          >
            <option value="all">All priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </div>
      </div>

      {hasFilters && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-muted-foreground">Filtered by</span>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChange(chip.clear)}
              aria-label={`Remove filter ${chip.label}`}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-card py-0.5 pl-2 pr-1 text-2xs font-medium transition hover:border-[var(--primary)]/40 hover:bg-muted"
            >
              {chip.label}
              <X className="size-3 text-muted-foreground" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            onClick={onReset}
            className="ml-0.5 rounded-md px-1.5 py-0.5 text-2xs font-semibold text-[var(--accent-foreground)] transition hover:bg-[var(--accent-soft)]"
          >
            Reset all
          </button>
        </div>
      )}
    </div>
  );
}
