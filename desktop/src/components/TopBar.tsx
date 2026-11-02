/**
 * Shell-level top bar (v1.2.0) — rendered on every page EXCEPT chat.
 *
 * The breadcrumb trail used to live inside each page's <PageHeader>, which pinned it to the
 * page body: it scrolled away with the content and every page had to remember to pass its
 * own trail. It now lives here, once, for the whole shell — the left side shows the current
 * page's breadcrumb (the exact trails the pages used to pass) and the right side a live
 * dependency-health pill, so the same two facts are visible on every workspace page.
 *
 * App.tsx renders this only when the active route is not "chat" — the chat page already
 * carries its own controls in its column header and deliberately gets no second bar.
 *
 * The pill is fed by the SAME health endpoint the dashboard uses (dashHealth →
 * /api/dashboard/health). There is no mock data: if the request fails, the pill renders
 * nothing rather than a fabricated count.
 *
 * Colours come from design tokens only (--border, --topbar-bg, --ok, --danger) — never a raw
 * Tailwind palette colour or a hex from a mockup.
 */
import { useEffect, useState } from "react";
import { dashHealth } from "@/features/dashboard/api";

/**
 * The exact breadcrumb trails the pages used to hand to <PageHeader>, keyed by the nav id
 * the shell is rendering. Kept verbatim so the trail reads identically to before — the only
 * thing that changed is WHERE it is drawn (shell, once) rather than per page.
 */
export const PAGE_CRUMBS: Record<string, string[]> = {
  dashboard: ["Workspace", "Overview"],
  articles: ["Workspace", "Knowledge"],
  tickets: ["Workspace", "Support"],
  domains: ["Workspace", "Domains & routing"],
  users: ["Workspace", "Users"],
  history: ["Workspace", "Conversations"],
  audits: ["Workspace", "Audit log"],
  settings: ["Workspace", "Settings"],
};

type Health = { healthy: number; total: number };

export default function TopBar({ navId }: { navId: string }) {
  const crumbs = PAGE_CRUMBS[navId] ?? [];
  const [health, setHealth] = useState<Health | null>(null);

  // Poll the real dependency health endpoint on the same 30s cadence the sidebar's
  // notification bell uses. A failure (or an empty service list) clears the pill — never a
  // fabricated count.
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const h = await dashHealth();
        if (!alive) return;
        const services: any[] = h?.services ?? [];
        if (services.length === 0) {
          setHealth(null);
          return;
        }
        setHealth({
          healthy: services.filter((s) => s?.status === "Healthy").length,
          total: services.length,
        });
      } catch {
        if (alive) setHealth(null);
      }
    }
    load();
    const iv = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const allHealthy = !!health && health.healthy === health.total;
  // The healthy reading is the mockup's wording ("N dependencies healthy in source"); the
  // degraded reading only reports what the payload actually says (how many are not healthy).
  const pillLabel = health
    ? allHealthy
      ? `${health.total} dependencies healthy in source`
      : `${health.total - health.healthy} of ${health.total} dependencies down`
    : null;

  return (
    <div
      data-slot="topbar"
      className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--topbar-bg)] px-4 lg:px-6"
    >
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        {crumbs.map((b, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            <span className={i === crumbs.length - 1 ? "font-medium text-foreground" : ""}>{b}</span>
          </span>
        ))}
      </nav>

      {pillLabel && (
        <span
          data-slot="health-pill"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-card px-2.5 py-1 text-2xs font-medium text-muted-foreground"
        >
          <span
            aria-hidden
            className={["size-1.5 rounded-full", allHealthy ? "bg-[var(--ok)]" : "bg-[var(--danger)]"].join(" ")}
          />
          {pillLabel}
        </span>
      )}
    </div>
  );
}
