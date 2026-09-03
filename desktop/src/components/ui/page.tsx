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
}: {
  title: string;
  badge?: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {/* v0.21.67 — standardized page icon chip (every page, both themes) */}
        {icon && (
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#0A1628] text-sky-300 shadow-sm">
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
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {title && (
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{title}</h2>
              {description && (
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
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

/** Standard primary button styles (use with shadcn Button className). */
export const btnPrimary =
  "rounded-xl bg-blue-600 px-4 py-2.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-blue-700";
export const btnSecondary =
  "rounded-xl border px-4 py-2.5 text-[11px] font-semibold transition hover:bg-muted";

/** Standard form field label + input classes. */
export const fieldLabel = "mb-1.5 block text-[10px] font-semibold";
export const fieldInput =
  "h-10 w-full rounded-xl border bg-transparent px-3 text-xs outline-none transition focus:border-blue-500 dark:border-slate-700";
