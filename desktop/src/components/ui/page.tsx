/**
 * Shared page layout primitives (v0.21.0) — one visual system for every page.
 *
 * PageShell  : outer wrapper — consistent vertical padding + centered max width
 * PageHeader : sticky-lite header bar (title, badge, description, actions)
 * SectionCard: white card with header row + body (used for tables, panels, forms)
 *
 * Sizes are fixed here so pages can never drift:
 *   header height 72px · content padding p-5 lg:p-8 · max width 1400px
 *   card radius 16px · titles: page=h1(text-xl) section=text-sm
 */
import type { ReactNode } from "react";

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto w-full max-w-[1400px] p-5 lg:p-8">{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  badge,
  description,
  actions,
  icon,
  breadcrumbs,
}: {
  title: string;
  badge?: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  /** B-5: optional breadcrumb trail, e.g. ["Workspace", "Tickets", "ITHD-22"] */
  breadcrumbs?: string[];
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>/</span>}
                <span className={i === breadcrumbs.length - 1 ? "font-medium text-foreground" : ""}>{b}</span>
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3">
        {/* v0.21.67 — standardized page icon chip (every page, both themes) */}
        {icon && (
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--brand-chip)] text-sky-300 shadow-sm">
            {icon}
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {badge && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                {badge}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
        </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionCard({
  title,
  description,
  icon,
  actions,
  children,
  bodyClassName = "",
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card text-card-foreground shadow-xs">
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-muted/20 px-6 py-4.5">
          <div className="flex min-w-0 items-center gap-3.5">
            {icon && (
              <div className="flex size-9 items-center justify-center rounded-xl bg-blue-50/80 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h2>
              {description && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Standard primary button styles (use with shadcn Button className) — Linear/Stripe style. */
export const btnPrimary =
  "rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-xs transition hover:bg-blue-700 active:scale-[0.98]";
export const btnSecondary =
  "rounded-xl border border-[var(--border)] bg-background px-4 py-2 text-xs font-medium text-foreground shadow-xs transition hover:bg-muted/50 active:scale-[0.98]";

/** Standard form field label + input classes — Linear/Stripe compact spacing. */
export const fieldLabel = "mb-1.5 block text-xs font-semibold text-slate-900 dark:text-white";
export const fieldInput =
  "h-9 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-xs text-foreground outline-none transition focus:border-blue-500";

/** B-11 — shared empty state: icon chip + headline + explanation + active CTA. */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-[background-color,transform] duration-150 hover:bg-blue-700 active:scale-[.98]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
