import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Database,
  ExternalLink,
  FolderInput,
  Layers,
  RefreshCw,
  Search,
  SearchX,
  X,
} from "lucide-react";

import {
  searchArticles,
  triggerSync,
  listArticleDomains,
  getSyncStatus,
  listArticles,
  bulkMoveArticles,
} from "@/features/knowledge/api";

import {
  getClassifierDomains,
  type ClassifierDomainItem,
} from "@/features/domains/api";
import {
  COLOR_OPTIONS,
  ICON_OPTIONS,
} from "@/features/domains/components/DomainClassifierManager";

import { EmptyState, ErrorState, PageHeader, PageShell } from "@/components/ui/page";
import { providerOf, allProviders } from "@/lib/kbProvider";
import ReclassifyPanel from "../components/ReclassifyPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Knowledge — the KB article browser, restyled to the workspace mockup.
 *
 * Layout follows the mockup: a Workspace / Knowledge breadcrumb under an ADMINISTRATION
 * eyebrow, one heading row whose actions are a sync indicator and the page's single
 * primary button, a row of four equal figures, an amber review band (only when the data
 * supports it), then ONE panel that owns its own heading, toolbar, domain chips, bulk bar,
 * table and range footer.
 *
 * Colours are the app's design tokens (--primary, --border, --muted-foreground) rather
 * than the mockup's literal hexes: the mockup is dark-only, this page must work in both
 * themes. Every figure is counted from a value the component already holds — nothing here
 * invents a number.
 */

type Props = {
  role?: string;
  userName?: string;
  perms?: Record<string, boolean>;
  onToast: (msg: string, kind?: "ok" | "err") => void;
};

type DomainCard = {
  domain: string;
  display_name?: string;
  description?: string;
  icon?: string;
  color?: string;
  custom_icon?: string | null;
  pages: number;
  last_synced: string | null;
};

type RecentItem = {
  title: string;
  domain: string;
  source_url: string;
  updated_by?: string | null;
  last_synced?: string | null;
};

type ListItem = RecentItem & {
  page_id: string;
};

type SyncStatus = {
  pages: number;
  last_run: {
    at: string;
    duration_ms: number;
    pages_created: number;
    pages_updated: number;
  } | null;
  healthy: boolean;
  beat_interval_minutes: number;
};

/* ==============================================================
   FALLBACK METADATA
============================================================== */

const DOMAIN_META: Record<
  string,
  {
    label: string;
    description: string;
    icon: any;
    iconClass: string;
    bgClass: string;
  }
> = {
  database: {
    label: "Database",
    description: "PostgreSQL, Oracle, SQL, deadlocks, performance",
    icon: BookOpen,
    iconClass: "text-blue-600 dark:text-blue-400",
    bgClass: "bg-blue-50 dark:bg-blue-950/40",
  },
  network: {
    label: "Network & Connectivity",
    description: "VPN, Wi-Fi, DNS, firewall, routing issues",
    icon: BookOpen,
    iconClass: "text-emerald-600 dark:text-emerald-400",
    bgClass: "bg-emerald-50 dark:bg-emerald-950/40",
  },
  security: {
    label: "Security & Identity",
    description: "Passwords, MFA, permissions, access requests",
    icon: BookOpen,
    iconClass: "text-purple-600 dark:text-purple-400",
    bgClass: "bg-purple-50 dark:bg-purple-950/40",
  },
  server: {
    label: "Server & Hardware",
    description: "Linux, Windows, hardware, virtualization",
    icon: BookOpen,
    iconClass: "text-indigo-600 dark:text-indigo-400",
    bgClass: "bg-indigo-50 dark:bg-indigo-950/40",
  },
  kubernetes: {
    label: "Kubernetes & Cloud",
    description: "Pods, deployments, clusters, cloud infrastructure",
    icon: BookOpen,
    iconClass: "text-sky-600 dark:text-sky-400",
    bgClass: "bg-sky-50 dark:bg-sky-950/40",
  },
  storage: {
    label: "Storage & Backups",
    description: "NFS, SAN, disk space, backup & restore",
    icon: BookOpen,
    iconClass: "text-cyan-600 dark:text-cyan-400",
    bgClass: "bg-cyan-50 dark:bg-cyan-950/40",
  },
  help_desk: {
    label: "Help Desk & Support",
    description: "General troubleshooting, desktop apps, user onboarding",
    icon: BookOpen,
    iconClass: "text-amber-600 dark:text-amber-400",
    bgClass: "bg-amber-50 dark:bg-amber-950/40",
  },
  general: {
    label: "General IT",
    description: "All other IT questions, company policy, miscellaneous",
    icon: BookOpen,
    iconClass: "text-slate-600 dark:text-slate-400",
    bgClass: "bg-slate-100 dark:bg-slate-800",
  },
};

/** P1#8 — wrap the matched search text so the user can see WHY a row matched. */
function highlight(text: string, term: string) {
  const t = (term || "").trim();
  if (!t) return text;
  const i = text.toLowerCase().indexOf(t.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-amber-200/70 px-0.5 text-amber-950 dark:bg-amber-500/30 dark:text-amber-100">
        {text.slice(i, i + t.length)}
      </mark>
      {text.slice(i + t.length)}
    </>
  );
}

/** Column names as the table shows them, so the sort summary matches the header. */
const SORT_LABELS: Record<"last_synced" | "title" | "domain", string> = {
  last_synced: "Synced",
  title: "Article Title",
  domain: "Domain",
};

/**
 * A removable filter chip. The label is the filter's human name and the × is the way out,
 * so the user never has to hunt for which control set the filter.
 */
function FilterPill({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--accent-soft)] px-1.5 py-0.5 font-medium text-[var(--accent-foreground)]">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove filter ${label}`}
        className="rounded p-0.5 transition hover:bg-black/10 dark:hover:bg-white/10"
      >
        <X className="size-2.5" />
      </button>
    </span>
  );
}

function relTime(iso?: string | null) {
  if (!iso) return "never";
  const d = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The mockup renders "Last sync" as a big duration ("28m") with a small "ago" beside it,
 * so the number and the unit are split rather than baked into one string.
 */
function relDuration(iso?: string | null): { value: string; suffix: string } {
  if (!iso) return { value: "never", suffix: "" };
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return { value: "never", suffix: "" };
  const mins = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (mins < 1) return { value: "just now", suffix: "" };
  if (mins < 60) return { value: `${mins}m`, suffix: "ago" };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { value: `${hours}h`, suffix: "ago" };
  return { value: `${Math.round(hours / 24)}d`, suffix: "ago" };
}

/** One figure per card — label left, icon right, big number, muted caption. */
function StatCard({
  icon,
  label,
  value,
  suffix,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  caption: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-card p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-[var(--primary)]">{icon}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-1 text-3xl font-semibold tracking-tight text-foreground">
        {value}
        {suffix && <span className="text-sm font-medium text-muted-foreground">{suffix}</span>}
      </div>
      <p className="mt-1.5 text-2xs leading-tight text-muted-foreground">{caption}</p>
    </div>
  );
}

/**
 * The header checkbox selects the rows on the CURRENT page, so it needs a third visual
 * state (indeterminate) that a plain `checked` boolean cannot express — a partly-selected
 * page must not read as fully selected.
 */
function PageCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="size-3.5 rounded border-[var(--border)] align-middle accent-[var(--primary)]"
    />
  );
}

export default function Knowledge({ role, onToast }: Props) {
  // v1.1.1 — domain_manager merged into knowledge (single Knowledge Manager role)
  const canManage = role === "admin" || role === "agent" || role === "knowledge" || role === "domain_manager";
  const canManageDomains = role === "admin" || role === "knowledge" || role === "domain_manager";

  // Classifier Domain State — this page reads the domain list only to label the article
  // counts and the domain chips. Editing domains, keywords and routing rules now lives on
  // its own page (features/domains/pages/DomainsPage), which owns the loading/error states.
  const [classifierDomains, setClassifierDomains] = useState<ClassifierDomainItem[]>([]);

  const loadClassifierData = async () => {
    try {
      const res = await getClassifierDomains();
      setClassifierDomains(res.domains ?? []);
    } catch {
      // counts fall back to whatever the article payload reports on its own
    }
  };

  useEffect(() => {
    loadClassifierData();
  }, []);

  // Article / Knowledge Base State
  const [domains, setDomains] = useState<DomainCard[] | null>(null);

  const domainCardMap = useMemo(() => {
    const map = new Map<string, any>();
    classifierDomains.forEach((d: any) => {
      map.set(d.domain_key, {
        domain: d.domain_key,
        display_name: d.display_name,
        description: d.description,
        icon: d.icon || undefined,
        color: d.color || undefined,
        custom_icon: d.custom_icon || null,
        pages: 0,
        last_synced: null,
      });
    });
    return map;
  }, [classifierDomains]);

  const metaFor = (domain?: string) => {
    const key = domain ?? "general";
    const card = domainCardMap.get(key);
    // v1.6.46 — the label must come from the DB, not a hardcoded map.
    // DOMAIN_META only ever held the original 7 domains and the fallback line was
    // `DOMAIN_META[domain] ?? DOMAIN_META.general`, so every domain added later
    // (software_dev, blockchain, cloud_aws, system) rendered as "General IT" —
    // three identical chips on the Knowledge page. Renaming a domain in the
    // Domains & Routing engine was ignored too, because the hardcoded label
    // shadowed the admin's display_name.
    // Order: admin domain list -> RBAC-filtered API list -> hardcoded entry
    // (icon/colour hints only) -> humanised key. It never claims "General IT"
    // for a domain that is not general.
    const apiCard = domains?.find((d) => d.domain === key);
    const fallback = DOMAIN_META[key];
    const humanized = key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const dynamicIconComp = card?.icon && ICON_OPTIONS[card.icon]?.icon;
    const resolvedIcon = dynamicIconComp || fallback?.icon || BookOpen;
    const dynamicColorDef = card?.color && COLOR_OPTIONS[card.color];
    const resolvedIconClass = dynamicColorDef
      ? dynamicColorDef.textClass
      : fallback?.iconClass || "text-blue-600 dark:text-blue-400";
    const resolvedBgClass = dynamicColorDef
      ? dynamicColorDef.bgClass
      : fallback?.bgClass || "bg-blue-50 dark:bg-blue-950/40";

    return {
      label: card?.display_name || apiCard?.display_name || fallback?.label || humanized,
      description: card?.description || apiCard?.description || fallback?.description || "",
      icon: resolvedIcon,
      iconClass: resolvedIconClass,
      bgClass: resolvedBgClass,
      custom_icon: card?.custom_icon,
    };
  };

  const [items, setItems] = useState<ListItem[] | null>(null);
  // v1.6.47 — real KB size from the API's COUNT(*), not the loaded page size
  const [kbTotal, setKbTotal] = useState<number | null>(null);
  // v1.6.47 — server-side paging/sorting/filtering. Doing any of this in the
  // browser only ever reordered the 50 loaded rows while looking like it had
  // searched the whole KB, which is the same class of wrong answer as the old
  // "50 articles" total.
  const [pageSize, setPageSize] = useState(50);
  const [sortKey, setSortKey] = useState<"last_synced" | "title" | "domain">("last_synced");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [qField, setQField] = useState<"all" | "title" | "body">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDomain, setBulkDomain] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [status, setStatus] = useState<SyncStatus | null>(null);

  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("all");
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [page, setPage] = useState(1);

  // Row → details dialog. Opens the real fields the list row already carries.
  const [detail, setDetail] = useState<ListItem | null>(null);

  // The amber band's "Review General IT" action scrolls the chip row into view.
  const chipsRef = useRef<HTMLDivElement>(null);

  /** True when anything is narrowing the list — drives the filter summary row. */
  const hasFilters = chip !== "all" || providerFilter !== "all" || query.trim().length > 0;

  async function loadBrowse() {
    const [domainResponse, syncResponse] = await Promise.all([
      listArticleDomains().catch(() => null),
      getSyncStatus().catch(() => null),
    ]);

    if (domainResponse?.domains) setDomains(domainResponse.domains);
    if (syncResponse) setStatus(syncResponse);
  }

  /** Build the query string for /api/articles-list from the current controls. */
  function buildQuery(domain: string, q: string, offset: number) {
    const parts = new URLSearchParams();
    if (domain !== "all") parts.set("domain", domain);
    if (q.trim()) { parts.set("q", q.trim()); parts.set("q_field", qField); }
    if (providerFilter !== "all") parts.set("provider", providerFilter);
    parts.set("sort", sortKey);
    parts.set("order", sortDir);
    parts.set("limit", String(pageSize));
    parts.set("offset", String(offset));
    return parts.toString();
  }

  async function loadList(domain: string, q = "", offset = 0) {
    setListing(true);
    setListError(null);
    try {
      // Keyword search still goes through the vector/hybrid endpoint when the user
      // asks for relevance; the plain list endpoint handles filters + paging.
      const res = await listArticles(buildQuery(domain, q, offset));
      setItems(res.articles ?? []);
      if (typeof res.total === "number") setKbTotal(res.total);
      setPage(Math.floor(offset / pageSize) + 1);
    } catch (err) {
      // Kept the toast (it is the app-wide convention for transient failures) AND added
      // the inline state, because a toast disappears and leaves an empty table behind —
      // which reads as "you have no articles" rather than "the request failed".
      setListError(err instanceof Error ? err.message : String(err));
      setItems([]);
      onToast("Failed to load article list", "err");
    } finally {
      setListing(false);
    }
  }

  /** Reload the current view (used after edits, bulk actions and re-classification). */
  function reload() {
    void loadList(chip, query, (page - 1) * pageSize);
    void loadBrowse();
  }

  useEffect(() => {
    loadBrowse();
  }, []);

  useEffect(() => {
    loadList(chip, query);
  }, [chip]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const res = await searchArticles(query.trim(), chip === "all" ? undefined : chip);
      const articles = res.data?.articles ?? [];
      setItems(
        articles.map((article: any, index: number) => ({
          page_id: `hit-${index}`,
          title: article.title ?? "",
          domain: article.domain ?? chip,
          source_url: article.source_url ?? "",
          updated_by: null,
          last_synced: null,
        }))
      );
      setPage(1);
      onToast(`${articles.length} search results found`);
    } catch {
      onToast("Search failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    setBusy(true);
    try {
      await triggerSync();
      onToast("Knowledge base synced");
      await loadBrowse();
      await loadList(chip);
    } catch {
      onToast("Sync failed", "err");
    } finally {
      setBusy(false);
    }
  }

  const chips = useMemo(() => {
    const list = ["all"];
    if (domains) {
      domains.forEach((d) => {
        if (!list.includes(d.domain)) list.push(d.domain);
      });
    }
    classifierDomains.forEach((d: ClassifierDomainItem) => {
      if (!list.includes(d.domain_key)) list.push(d.domain_key);
    });
    return list;
  }, [domains, classifierDomains]);

  /** Reset every control that narrows the list, and reload from the top. */
  function resetAll() {
    setProviderFilter("all");
    setChip("all");
    setQuery("");
    setSelected(new Set());
    void loadList("all", "", 0);
  }

  const lastSync = relDuration(status?.last_run?.at);
  const total = kbTotal ?? items?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil((kbTotal ?? 0) / pageSize));

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={["Workspace", "Knowledge"]}
        eyebrow="Administration"
        icon={<BookOpen className="size-5" />}
        badge={role === "admin" ? "Administrator" : role === "agent" ? "IT Support" : role === "knowledge" ? "Knowledge Manager" : "User"}
        title="Knowledge base"
        description="Keep your assistant's knowledge organized, searchable, and up to date."
        actions={
          <div className="flex items-center gap-3">
            {/* Small live indicator — the same two states the page always reported. */}
            <div
              className={[
                "hidden items-center gap-2 rounded-xl border px-3 py-1.5 text-xs sm:flex",
                status?.healthy
                  ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                  : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
              ].join(" ")}
            >
              <span
                className={[
                  "size-2 rounded-full",
                  status?.healthy ? "bg-emerald-500" : "bg-amber-500",
                ].join(" ")}
              />
              <span className="font-semibold text-foreground">
                {status?.healthy ? "KB Synced" : "Sync Pending"}
              </span>
              <span className="text-2xs text-muted-foreground">
                {status?.last_run ? `(${relTime(status.last_run.at)})` : ""}
              </span>
            </div>

            {/* Primary: syncing is the page's one "do something" action. */}
            <button
              type="button"
              disabled={busy}
              onClick={handleSync}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw className={["size-3.5", busy ? "animate-spin" : ""].join(" ")} />
              Sync now
            </button>
          </div>
        }
      />

      <main className="space-y-5">
        {/* FOUR EQUAL FIGURES
            Each value is counted from a value the page already holds: the KB size from
            the API's COUNT(*), the domain count from the domain list, the source count
            from the provider table, and the sync age from /sync-status. */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            icon={<BookOpen className="size-4" />}
            label="Articles"
            value={kbTotal != null ? kbTotal.toLocaleString() : "—"}
            caption="In your knowledge base"
          />
          <StatCard
            icon={<Layers className="size-4" />}
            label="Domains"
            value={domains ? domains.length.toLocaleString() : "—"}
            caption="Organized by expertise"
          />
          <StatCard
            icon={<Database className="size-4" />}
            label="Sources"
            value={allProviders().length.toLocaleString()}
            caption="Connected content sources"
          />
          <StatCard
            icon={<Clock3 className="size-4" />}
            label="Last sync"
            value={lastSync.value}
            suffix={lastSync.suffix}
            caption={`Runs every ${status?.beat_interval_minutes ?? 30} min`}
          />
        </section>

        {/* REVIEW BAND
            P1#10 — surface the articles no domain claimed. After the LLM pass this is
            small, but it is exactly the set that silently goes missing from every domain
            browse view. Domains with no description cannot be chosen by the classifier
            either, so both are reported here. Rendered ONLY when the data supports it. */}
        {!listing && items && (() => {
          const apiGen = domains?.find((d) => d.domain === "general")?.pages;
          const gen = typeof apiGen === "number" ? apiGen : (domainCardMap.get("general")?.pages ?? 0);
          const noDesc = (domains ?? []).filter((d) => !d.description || d.description.trim().length < 25);
          if (gen === 0 && noDesc.length === 0) return null;
          return (
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-2xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Needs review
                </div>
                <p className="mt-0.5 font-semibold">A little organization goes a long way</p>
                <p className="mt-0.5 leading-relaxed">
                  {gen > 0 && (
                    <>{gen} article{gen === 1 ? "" : "s"} still in General IT.</>
                  )}
                  {gen > 0 && noDesc.length > 0 && " "}
                  {noDesc.length > 0 && (
                    <>{noDesc.length} domain{noDesc.length === 1 ? "" : "s"} have no description and cannot be used by the classifier.</>
                  )}
                </p>
              </div>
              {gen > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setChip("general");
                    setPage(1);
                    setSelected(new Set());
                    void loadList("general", query, 0);
                    chipsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
                  }}
                  className="shrink-0 rounded-lg border border-amber-300/70 bg-white/60 px-3 py-1.5 font-medium transition hover:bg-white/90 dark:border-amber-800 dark:bg-amber-950/40 dark:hover:bg-amber-950/60"
                >
                  Review General IT →
                </button>
              )}
            </div>
          );
        })()}

        {/* P3c — LLM re-classification audit. Gated on manage_domains, since this changes
            domain assignment (the same capability as the Domains & Routing engine). */}
        {canManageDomains && (
          <ReclassifyPanel onApplied={() => { void loadList(chip, query); void loadBrowse(); }} />
        )}

        {/* THE PANEL — heading, toolbar, domain chips, bulk bar, table and footer all live
            in one surface so the whole article library reads as a single unit. */}
        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-card shadow-xs">
          {/* 1. heading row: h2 + count badge, right-aligned muted note */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
            <h2 className="text-sm font-semibold text-foreground">
              Article library
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-2xs font-normal text-muted-foreground">
                {total}
              </span>
            </h2>
            <span className="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
              Sorted by {SORT_LABELS[sortKey]}
              {sortDir === "desc" ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
            </span>
          </div>

          {/* Result count is a live region so a filter change is announced, not silent. */}
          <p role="status" aria-live="polite" className="px-5 pb-3 pt-1 text-xs text-muted-foreground">
            {listing ? (
              "Loading articles…"
            ) : listError ? (
              "Could not load articles"
            ) : (
              <>
                <span className="font-semibold text-foreground">{total}</span>{" "}
                article{total === 1 ? "" : "s"}
                {hasFilters ? " matching the current filters" : " in the knowledge base"}
              </>
            )}
          </p>

          {/* 2. toolbar: search (flex 1) + source + sort + Reset */}
          <div className="flex flex-wrap items-center gap-2.5 border-y border-[var(--border)] px-5 py-4">
            <form onSubmit={handleSearch} className="flex min-w-[120px] flex-1 items-center gap-2.5">
              <div className="relative min-w-[120px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search solutions, errors, procedures…"
                  aria-label="Search the knowledge base"
                  className="h-9 w-full rounded-lg border border-[var(--border)] bg-background pl-9 pr-3 text-xs outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
                />
              </div>

              <select
                value={qField}
                onChange={(e) => setQField(e.target.value as "all" | "title" | "body")}
                title="Where to look for the search text"
                aria-label="Search field"
                className="h-9 shrink-0 rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none transition focus:border-[var(--primary)]"
              >
                <option value="all">Title + body</option>
                <option value="title">Title only</option>
                <option value="body">Body only</option>
              </select>

              <Button type="submit" size="sm" disabled={busy || !query.trim()} className="h-9 rounded-lg px-4 text-xs">
                Search
              </Button>
            </form>

            {/* Source was a second chip band. It is a refinement, not a browse axis, so a
                select communicates the same thing in one row. */}
            <select
              value={providerFilter}
              onChange={(e) => { setProviderFilter(e.target.value); setSelected(new Set()); void loadList(chip, query, 0); }}
              title="Filter by knowledge source"
              aria-label="Filter by knowledge source"
              className="h-9 shrink-0 rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none transition focus:border-[var(--primary)]"
            >
              <option value="all">All sources</option>
              {allProviders().map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>

            {/* Sorting is server-side: the select re-sorts the whole KB, not the loaded page. */}
            <select
              value={`${sortKey}:${sortDir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split(":") as [typeof sortKey, "asc" | "desc"];
                setSortKey(k);
                setSortDir(d);
                void loadList(chip, query, 0);
              }}
              title="Sort order"
              aria-label="Sort order"
              className="h-9 shrink-0 rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none transition focus:border-[var(--primary)]"
            >
              <option value="last_synced:desc">Newest first</option>
              <option value="last_synced:asc">Oldest first</option>
              <option value="title:asc">Title A–Z</option>
              <option value="title:desc">Title Z–A</option>
              <option value="domain:asc">Domain A–Z</option>
              <option value="domain:desc">Domain Z–A</option>
            </select>

            <button
              type="button"
              onClick={resetAll}
              disabled={!hasFilters}
              className="h-9 shrink-0 rounded-lg border border-[var(--border)] bg-card px-3.5 text-xs font-semibold transition hover:bg-muted disabled:opacity-40"
            >
              Reset
            </button>
          </div>

          {/* 3. domain chips — the primary browse axis, with real per-domain counts. */}
          <div
            ref={chipsRef}
            className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--border)] px-5 py-3 [scrollbar-width:thin]"
          >
            <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {chips.map((domain) => {
              const active = domain === chip;
              const meta = domain === "all" ? null : metaFor(domain);
              const label = domain === "all" ? "All domains" : meta!.label;
              const apiCount = domains?.find((d) => d.domain === domain)?.pages;
              const count = domain === "all"
                ? (kbTotal ?? items?.length)
                : (typeof apiCount === "number" ? apiCount : domainCardMap.get(domain)?.pages);
              const desc = meta?.description;
              return (
                <button
                  key={domain}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setChip(domain);
                    setPage(1);
                    setSelected(new Set());
                    void loadList(domain, query, 0);
                  }}
                  /* P0#1 — the per-domain colour and wording come from the DB, so a
                     domain whose display_name is wrong is visible at a glance instead
                     of silently reading like its neighbour. */
                  title={desc ? `${label} — ${desc}` : label}
                  className={[
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
                    active
                      ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] shadow-xs"
                      : "border-[var(--border)] bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  ].join(" ")}
                >
                  {meta && <meta.icon className={`size-3 ${active ? "text-[var(--primary-foreground)]" : meta.iconClass}`} />}
                  {label}
                  {typeof count === "number" && (
                    <span className={active ? "text-[var(--primary-foreground)]/70" : "text-muted-foreground"}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* One summary of what is narrowing the list, with one way out. The old layout
              offered "Clear filters" only inside the source band, so a user who had
              filtered by domain had no visible way to reset it. */}
          {hasFilters && (
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-5 py-2.5 text-xs">
              <span className="text-muted-foreground">Filtered by</span>
              {query.trim() && <FilterPill label={`"${query.trim()}"`} onClear={() => { setQuery(""); void loadList(chip, "", 0); }} />}
              {chip !== "all" && <FilterPill label={metaFor(chip).label} onClear={() => { setChip("all"); void loadList("all", query, 0); }} />}
              {providerFilter !== "all" && (
                <FilterPill label={allProviders().find((p) => p.key === providerFilter)?.label ?? providerFilter} onClear={() => { setProviderFilter("all"); void loadList(chip, query, 0); }} />
              )}
              <button
                type="button"
                onClick={resetAll}
                className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-[var(--accent-foreground)] transition hover:bg-[var(--accent-soft)]"
              >
                <X className="size-3" /> Clear all
              </button>
            </div>
          )}

          {/* 4. bulk bar — appears only when rows are selected. */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--accent-soft)] px-5 py-2.5">
              <span className="text-xs font-semibold text-[var(--accent-foreground)]">
                {selected.size} selected across pages
              </span>
              <select
                value={bulkDomain}
                onChange={(e) => setBulkDomain(e.target.value)}
                className="h-8 rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none focus:border-[var(--primary)]" aria-label="{selected.size} selected">
                <option value="">Move to domain…</option>
                {chips.filter((c) => c !== "all").map((c) => (
                  <option key={c} value={c}>{metaFor(c).label}</option>
                ))}
              </select>
              <Button
                size="sm"
                className="h-8 rounded-lg text-xs"
                disabled={!bulkDomain || bulkBusy}
                onClick={async () => {
                  setBulkBusy(true);
                  try {
                    const res = await bulkMoveArticles([...selected], bulkDomain);
                    const d = res.data as { moved?: number };
                    onToast(`Moved ${d.moved ?? 0} article(s) to ${metaFor(bulkDomain).label}`);
                    setSelected(new Set()); setBulkDomain(""); reload();
                  } catch { onToast("Bulk move failed", "err"); }
                  finally { setBulkBusy(false); }
                }}
              >
                <FolderInput className="size-3" /> Move
              </Button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Clear selection
              </button>
            </div>
          )}

          {/* 5. the table — scrolls horizontally on narrow screens. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-xs">
              {/* Sticky: the list is long and paging scrolls the header out of view, so the
                  column names — and the sort control inside them — have to stay reachable. */}
              <thead className="sticky top-0 z-10 border-b border-[var(--border)] bg-muted/60 backdrop-blur-sm">
                <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-9 px-3 py-3.5">
                    {canManage && items && items.length > 0 && (
                      <PageCheckbox
                        label="Select all rows on this page"
                        checked={items.every((a) => selected.has(a.page_id))}
                        indeterminate={items.some((a) => selected.has(a.page_id)) && !items.every((a) => selected.has(a.page_id))}
                        onChange={(checked) => {
                          const next = new Set(selected);
                          items.forEach((a) => (checked ? next.add(a.page_id) : next.delete(a.page_id)));
                          setSelected(next);
                        }}
                      />
                    )}
                  </th>
                  {([
                    { k: "title", l: "Article title", cls: "px-5 py-3.5 font-semibold" },
                    { k: null, l: "Source", cls: "px-4 py-3.5 font-semibold" },
                    { k: "domain", l: "Domain", cls: "px-4 py-3.5 font-semibold" },
                    { k: "last_synced", l: "Last sync", cls: "px-4 py-3.5 font-semibold" },
                  ] as const).map((h) => (
                    <th key={h.l} className={h.cls}>
                      {h.k ? (
                        /* Sorting is server-side: clicking sorts the whole KB,
                           not just the rows currently loaded. */
                        <button
                          type="button"
                          onClick={() => {
                            const nextDir = sortKey === h.k && sortDir === "desc" ? "asc" : "desc";
                            setSortKey(h.k as typeof sortKey);
                            setSortDir(nextDir);
                            void loadList(chip, query, 0);
                          }}
                          className="inline-flex items-center gap-1 transition hover:text-foreground"
                          aria-label={`Sort by ${h.l}`}
                          title={`Sort by ${h.l}`}
                        >
                          {h.l}
                          {sortKey === h.k ? (
                            sortDir === "desc" ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-30" />
                          )}
                        </button>
                      ) : (
                        h.l
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listing ? (
                  <tr>
                    <td colSpan={5} className="p-4">
                      <Skeleton className="h-9 w-full rounded-lg" />
                    </td>
                  </tr>
                ) : listError ? (
                  <tr>
                    <td colSpan={5}>
                      <ErrorState
                        compact
                        title="Could not load the knowledge base"
                        detail={listError}
                        onRetry={() => void loadList(chip, query, (page - 1) * pageSize)}
                      />
                    </td>
                  </tr>
                ) : !items || items.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      {/* "Nothing here yet" and "nothing matches" need different words:
                          only the second is something the user caused and can undo, so
                          only it gets the clear-filters action. */}
                      {(kbTotal ?? 0) === 0 && !query && chip === "all" && providerFilter === "all" ? (
                        <EmptyState
                          icon={<BookOpen className="size-5" />}
                          title="No articles yet"
                          description="Articles arrive from your knowledge sources and from the sync jobs. Connect a source in Settings → Integrations, or create one manually."
                        />
                      ) : (
                        <EmptyState
                          icon={<SearchX className="size-5" />}
                          title="No articles match this filter"
                          description={kbTotal && kbTotal > 0 ? `${kbTotal} article${kbTotal === 1 ? "" : "s"} in the knowledge base, but none match the current filters.` : "No articles match the current filters."}
                          actionLabel="Clear filters"
                          onAction={() => { setChip("all"); setProviderFilter("all"); setQuery(""); void loadList("all", "", 0); }}
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  items.map((article) => {
                    const meta = metaFor(article.domain);
                    return (
                      <tr
                        key={article.page_id}
                        className={[
                          "border-t border-[var(--border)]/60 transition",
                          selected.has(article.page_id)
                            ? "bg-[var(--accent-soft)]"
                            : "hover:bg-muted/40",
                        ].join(" ")}
                      >
                        <td className="px-3 py-3 align-middle">
                          {canManage && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${article.title || article.page_id}`}
                              checked={selected.has(article.page_id)}
                              onChange={(e) => {
                                const next = new Set(selected);
                                if (e.target.checked) next.add(article.page_id); else next.delete(article.page_id);
                                setSelected(next);
                              }}
                              className="size-3.5 rounded border-[var(--border)] align-middle accent-[var(--primary)]"
                            />
                          )}
                        </td>
                        {/* Was `truncate` on a fixed max-width, which cut long article
                            titles with no way to read the rest. Two lines, then ellipsis,
                            plus the full text in the tooltip. The cell is a button now:
                            it opens the row's details dialog. */}
                        <td className="max-w-[400px] px-5 py-3">
                          <button
                            type="button"
                            onClick={() => setDetail(article)}
                            title={article.title}
                            className="block max-w-full text-left font-medium text-foreground underline-offset-2 transition hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                          >
                            <span className="line-clamp-2">
                              {/* P1#8 — show WHERE the search text matched so the
                                  result does not look arbitrary. */}
                              {query.trim() ? highlight(article.title, query) : article.title}
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          {/* The badge IS the link to the source. Previously a separate
                              "Actions" column held a lone external-link icon pointing at
                              the same URL. */}
                          {article.source_url ? (
                            <a
                              href={article.source_url}
                              target="_blank"
                              rel="noreferrer"
                              title={`Open source: ${article.source_url}`}
                              className="inline-flex items-center gap-1 rounded-md transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                            >
                              <Badge variant="outline" className={`text-2xs ${providerOf(article).className}`}>
                                {providerOf(article).label}
                              </Badge>
                              <ExternalLink className="size-2.5 text-muted-foreground" />
                            </a>
                          ) : (
                            <Badge variant="outline" className={`text-2xs ${providerOf(article).className}`}>
                              {providerOf(article).label}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-2xs ${meta.bgClass} ${meta.iconClass}`}>
                            {meta.label}
                          </Badge>
                        </td>
                        <td
                          className="px-4 py-3 text-xs text-muted-foreground"
                          title={article.last_synced ? new Date(article.last_synced).toLocaleString() : "never synced"}
                        >
                          {relTime(article.last_synced)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 6. footer — range on the left, rows-per-page + pager on the right. */}
          {items && kbTotal != null && kbTotal > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3.5">
              <p className="text-xs text-muted-foreground">
                Showing {(page - 1) * pageSize + 1}–{Math.min((page - 1) * pageSize + items.length, kbTotal)} of {kbTotal}
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setSelected(new Set()); void loadList(chip, query, 0); }}
                  className="h-8 rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none focus:border-[var(--primary)]"
                  title="Rows per page" aria-label="Rows per page">
                  {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Previous page"
                    disabled={page <= 1 || listing}
                    onClick={() => { setSelected(new Set()); void loadList(chip, query, (page - 2) * pageSize); }}
                    className="grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-card transition hover:bg-muted disabled:opacity-40"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <span className="px-1 text-xs text-muted-foreground">{page} / {totalPages}</span>
                  <button
                    type="button"
                    aria-label="Next page"
                    disabled={page >= totalPages || listing}
                    onClick={() => { setSelected(new Set()); void loadList(chip, query, page * pageSize); }}
                    className="grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-card transition hover:bg-muted disabled:opacity-40"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Where the numbers above come from. Stated plainly so a count is never read as a
            guess: the total is the API's COUNT(*), not the rows on this page. */}
        <p className="text-2xs leading-relaxed text-muted-foreground">
          Counts are read from the Knowledge Base Articles index — the total is a COUNT(*)
          over the whole filtered set, not just the rows on this page. Domain counts come
          from each domain's article list, and the source options come from the connected
          content providers.
        </p>
      </main>

      {/* Details dialog — the title cell opens it. It shows only the fields the list row
          already carries, so nothing here is invented. */}
      {detail && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Article details: ${detail.title}`}
          onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-card p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold">{detail.title}</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setDetail(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
              >
                <X className="size-4" />
              </button>
            </div>

            <dl className="mt-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Domain</dt>
                <dd>
                  <Badge variant="outline" className={`text-2xs ${metaFor(detail.domain).bgClass} ${metaFor(detail.domain).iconClass}`}>
                    {metaFor(detail.domain).label}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Source</dt>
                <dd>
                  <Badge variant="outline" className={`text-2xs ${providerOf(detail).className}`}>
                    {providerOf(detail).label}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Last sync</dt>
                <dd className="text-foreground">
                  {detail.last_synced
                    ? `${relTime(detail.last_synced)} · ${new Date(detail.last_synced).toLocaleString()}`
                    : "never"}
                </dd>
              </div>
              {detail.updated_by && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Updated by</dt>
                  <dd className="text-foreground">{detail.updated_by}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Page ID</dt>
                <dd className="font-mono text-2xs text-foreground">{detail.page_id}</dd>
              </div>
            </dl>

            {detail.source_url && (
              <a
                href={detail.source_url}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
              >
                Open source <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
