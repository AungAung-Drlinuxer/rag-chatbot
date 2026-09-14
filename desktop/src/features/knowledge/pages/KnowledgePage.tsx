import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  Clock3,
  ExternalLink,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
  AlertTriangle,
  FolderInput,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
} from "lucide-react";

import {
  searchArticles,
  createArticle,
  updateArticle,
  deleteArticle,
  triggerSync,
  articleDraft,
  listArticleDomains,
  getSyncStatus,
  listArticles,
  bulkMoveArticles,
  bulkDeleteArticles,
} from "@/features/knowledge/api";

import {
  getClassifierDomains,
  type ClassifierDomainItem,
} from "@/features/domains/api";
import {
  COLOR_OPTIONS,
  DomainClassifierManager,
  ICON_OPTIONS,
} from "@/features/domains/components/DomainClassifierManager";

import { PageShell, PageHeader } from "@/components/ui/page";
import { providerOf, allProviders } from "@/lib/kbProvider";
import ReclassifyPanel from "../components/ReclassifyPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  role?: string;
  userName?: string;
  perms?: Record<string, boolean>;
  initialTab?: "articles" | "domains";
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
      <mark className="rounded bg-amber-200/70 px-0.5 text-slate-900 dark:bg-amber-500/30 dark:text-amber-100">
        {text.slice(i, i + t.length)}
      </mark>
      {text.slice(i + t.length)}
    </>
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

export default function Knowledge({
  role,
  initialTab,
  onToast,
}: Props) {
  // v1.1.1 — domain_manager merged into knowledge (single Knowledge Manager role)
  const canManage = role === "admin" || role === "agent" || role === "knowledge" || role === "domain_manager";
  const canManageDomains = role === "admin" || role === "knowledge" || role === "domain_manager";

  // Tab State: "articles" | "domains"
  const [activeTab, setActiveTab] = useState<"articles" | "domains">(initialTab || "articles");

  // Classifier Domain State
  const [classifierDomains, setClassifierDomains] = useState<ClassifierDomainItem[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [domainsError, setDomainsError] = useState<string | null>(null);

  const loadClassifierData = async () => {
    try {
      setDomainsLoading(true);
      setDomainsError(null);
      const res = await getClassifierDomains();
      setClassifierDomains(res.domains ?? []);
    } catch (e: any) {
      setDomainsError(e?.message || "Failed to load domain configuration");
    } finally {
      setDomainsLoading(false);
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

  const [edit, setEdit] = useState<{
    page_id: string;
    title: string;
    domain: string;
    body: string;
  } | null>(null);

  const [page, setPage] = useState(1);

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
    try {
      // Keyword search still goes through the vector/hybrid endpoint when the user
      // asks for relevance; the plain list endpoint handles filters + paging.
      const res = await listArticles(buildQuery(domain, q, offset));
      setItems(res.articles ?? []);
      if (typeof res.total === "number") setKbTotal(res.total);
      setPage(Math.floor(offset / pageSize) + 1);
    } catch {
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

  async function handleDelete(pageId: string, title: string) {
    if (!confirm(`Delete "${title}"?`)) return;
    try {
      await deleteArticle(pageId);
      onToast("Article deleted");
      await loadBrowse();
      await loadList(chip);
    } catch {
      onToast("Delete failed", "err");
    }
  }

  async function handleSaveEdit() {
    if (!edit || !edit.title.trim()) return;
    setBusy(true);
    try {
      if (edit.page_id.startsWith("manual-")) {
        await createArticle({
          title: edit.title.trim(),
          domain: edit.domain,
          body: edit.body.trim(),
        });
        onToast("Article created");
      } else {
        await updateArticle(edit.page_id, {
          title: edit.title.trim(),
          domain: edit.domain,
          body: edit.body.trim(),
        });
        onToast("Article updated");
      }
      setEdit(null);
      await loadBrowse();
      await loadList(chip);
    } catch {
      onToast("Save failed", "err");
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

  return (
    <PageShell>
      <PageHeader
        icon={<BookOpen className="size-5" />}
        badge={role === "admin" ? "Administrator" : role === "agent" ? "IT Support" : role === "knowledge" ? "Knowledge Manager" : "User"}
        title="Knowledge & Domain Hub"
        description="Unified management of AI classifier routing rules, Confluence KB articles, and synchronization"
        actions={
          <div className="flex items-center gap-3">
            <div
              className={[
                "hidden items-center gap-2 rounded-xl border px-3 py-1.5 sm:flex text-xs",
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
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {status?.healthy ? "KB Synced" : "Sync Pending"}
                </span>
                <span className="text-[10px] text-muted-foreground ml-1.5">
                  {status?.last_run ? `(${relTime(status.last_run.at)})` : ""}
                </span>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="rounded-xl h-9"
              disabled={busy}
              onClick={handleSync}
            >
              <RefreshCw className={["mr-1.5 size-3.5", busy ? "animate-spin" : ""].join(" ")} />
              Sync now
            </Button>
          </div>
        }
      />

      <main className="mx-auto max-w-[1560px] p-4 lg:p-6 space-y-5">
        {/* ==============================================================
            MODERN TAB NAVIGATION
        ============================================================== */}
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("articles")}
              className={[
                "flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl transition",
                activeTab === "articles"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800",
              ].join(" ")}
            >
              <BookOpen className="size-4" />
              <span>Knowledge Base Articles</span>
              <span
                className={[
                  "ml-1 rounded-md px-1.5 py-0.5 text-[10px]",
                  activeTab === "articles" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
                ].join(" ")}
              >
                {kbTotal != null
                  ? `${kbTotal}${items && items.length < kbTotal ? ` · ${items.length} shown` : ""}`
                  : items
                    ? items.length
                    : "…"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("domains")}
              className={[
                "flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl transition",
                activeTab === "domains"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800",
              ].join(" ")}
            >
              <Layers className="size-4" />
              <span>Domains & Routing Engine</span>
              <span
                className={[
                  "ml-1 rounded-md px-1.5 py-0.5 text-[10px]",
                  activeTab === "domains" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
                ].join(" ")}
              >
                {classifierDomains.length}
              </span>
            </button>
          </div>

        </div>

        {/* ==============================================================
            TAB 1: KNOWLEDGE BASE ARTICLES (FULL WIDTH)
        ============================================================== */}
        {activeTab === "articles" && (
          <div className="space-y-5">
            {/* TOP SEARCH BAR & DOMAIN CHIPS */}
            <section className="rounded-2xl border border-[var(--border)] bg-gradient-to-r from-blue-50/40 via-card to-indigo-50/20 p-5 shadow-xs dark:from-blue-950/15 dark:via-card dark:to-indigo-950/15">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Sparkles className="size-4 text-blue-600" />
                    Find Knowledge & Verify Document Coverage
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Real-time lexical and semantic search across indexed documents retrieved for AI answers.
                  </p>
                </div>

                <form onSubmit={handleSearch} className="flex items-center gap-2 w-full md:w-[420px]">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search solutions, errors, procedures..."
                      className="h-10 w-full rounded-xl border border-[var(--border)] bg-white pl-9 pr-3 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:bg-slate-900"
                    />
                  </div>
                  <select
                    value={qField}
                    onChange={(e) => setQField(e.target.value as "all" | "title" | "body")}
                    title="Where to look for the search text"
                    className="h-10 shrink-0 rounded-xl border border-[var(--border)] bg-white px-2 text-xs outline-none dark:bg-slate-900"
                  >
                    <option value="all">Title + body</option>
                    <option value="title">Title only</option>
                    <option value="body">Body only</option>
                  </select>
                  <Button type="submit" size="sm" disabled={busy || !query.trim()} className="h-10 rounded-xl bg-blue-600 px-5 text-xs text-white hover:bg-blue-700 disabled:bg-blue-300 disabled:text-white dark:disabled:bg-blue-950">
                    Search
                  </Button>
                </form>
              </div>

              <div className="mt-4 flex items-center gap-1.5 overflow-x-auto pt-3 border-t border-[var(--border)]/60 [scrollbar-width:thin]">
                <span className="text-[11px] font-semibold text-slate-400 mr-1 shrink-0">Filter Domain:</span>
                {chips.map((domain) => {
                  const active = domain === chip;
                  const meta = domain === "all" ? null : metaFor(domain);
                  const label = domain === "all" ? "All Domains" : meta!.label;
                  const apiCount = domains?.find((d) => d.domain === domain)?.pages;
                  const count = typeof apiCount === "number" ? apiCount : domainCardMap.get(domain)?.pages;
                  const desc = meta?.description;
                  return (
                    <button
                      key={domain}
                      type="button"
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
                        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition shrink-0",
                        active
                          ? "border-blue-600 bg-blue-600 text-white shadow-xs"
                          : `border-[var(--border)] bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800`,
                      ].join(" ")}
                    >
                      {meta && <meta.icon className={`size-3 ${active ? "text-white" : meta.iconClass}`} />}
                      {label}
                      {typeof count === "number" && (
                        <span className={active ? "text-white/70" : "text-slate-400"}>{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* P1#6 — provider filter. Six sources feed this KB and there was no way
                  to see which provider an article set came from beyond the row badge. */}
              <div className="mt-3 flex items-center gap-1.5 overflow-x-auto border-t border-[var(--border)]/60 pt-3 [scrollbar-width:thin]">
                <span className="text-[11px] font-semibold text-slate-400 mr-1 shrink-0">Filter Source:</span>
                {[{ k: "all", l: "All" }, ...allProviders().map((p) => ({ k: p.key, l: p.label }))].map((o) => {
                  const active = providerFilter === o.k;
                  return (
                    <button
                      key={o.k}
                      type="button"
                      onClick={() => { setProviderFilter(o.k); setSelected(new Set()); void loadList(chip, query, 0); }}
                      className={[
                        "inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium transition shrink-0",
                        active
                          ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                          : "border-[var(--border)] bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300",
                      ].join(" ")}
                    >
                      {o.l}
                    </button>
                  );
                })}
                {(providerFilter !== "all" || chip !== "all" || query.trim()) && (
                  <button
                    type="button"
                    onClick={() => { setProviderFilter("all"); setChip("all"); setQuery(""); setSelected(new Set()); void loadList("all", "", 0); }}
                    className="ml-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-blue-600 underline shrink-0"
                  >
                    <X className="size-3" /> Clear filters
                  </button>
                )}
              </div>
            </section>

            {/* P1#10 — surface the articles no domain claimed. After the LLM pass this
                is small, but it is exactly the set that silently goes missing from
                every domain browse view. Domains with no description cannot be chosen
                by the classifier either, so both are reported here. */}
            {!listing && items && (() => {
              const apiGen = domains?.find((d) => d.domain === "general")?.pages;
              const gen = typeof apiGen === "number" ? apiGen : (domainCardMap.get("general")?.pages ?? 0);
              const noDesc = (domains ?? []).filter((d) => !d.description || d.description.trim().length < 25);
              if (gen === 0 && noDesc.length === 0) return null;
              return (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="size-3.5" /> Needs review
                  </span>
                  {gen > 0 && (
                    <button type="button" className="underline" onClick={() => { setChip("general"); void loadList("general", "", 0); }}>
                      {gen} article(s) still in General IT
                    </button>
                  )}
                  {noDesc.length > 0 && (
                    <span title={noDesc.map((d) => d.display_name).join(", ")}>
                      {noDesc.length} domain(s) have no description — the AI classifier cannot
                      route to them
                    </span>
                  )}
                </div>
              );
            })()}

            {/* P1#7 — bulk actions. Appears only when rows are selected. */}
            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/30">
                <span className="text-[11px] font-semibold text-blue-800 dark:text-blue-200">
                  {selected.size} selected
                </span>
                <select
                  value={bulkDomain}
                  onChange={(e) => setBulkDomain(e.target.value)}
                  className="h-8 rounded-lg border border-[var(--border)] bg-white px-2 text-[11px] dark:bg-slate-900"
                >
                  <option value="">Move to domain…</option>
                  {chips.filter((c) => c !== "all").map((c) => (
                    <option key={c} value={c}>{metaFor(c).label}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  className="h-8 rounded-lg text-[11px]"
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
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg text-[11px] text-rose-600"
                  disabled={bulkBusy}
                  onClick={async () => {
                    if (!window.confirm(`Delete ${selected.size} article(s)? This removes their indexed chunks and cannot be undone.`)) return;
                    setBulkBusy(true);
                    try {
                      const res = await bulkDeleteArticles([...selected]);
                      const d = res.data as { deleted?: number };
                      onToast(`Deleted ${d.deleted ?? 0} article(s)`);
                      setSelected(new Set()); reload();
                    } catch { onToast("Bulk delete failed", "err"); }
                    finally { setBulkBusy(false); }
                  }}
                >
                  <Trash2 className="size-3" /> Delete
                </Button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-[11px] text-muted-foreground underline"
                >
                  Clear selection
                </button>
              </div>
            )}

            {/* FULL WIDTH ARTICLES LIST */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <BookOpen className="size-4 text-blue-600 dark:text-blue-400" />
                    Knowledge Base Articles
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Indexed documents retrieved for RAG context and user inquiries
                  </p>
                </div>

                {canManage && (
                  <Button
                    size="sm"
                    className="h-8 rounded-lg px-3 text-xs bg-blue-600 text-white hover:bg-blue-700"
                    onClick={() =>
                      setEdit({
                        page_id: `manual-${Date.now()}`,
                        title: "",
                        domain: "general",
                        body: "",
                      })
                    }
                  >
                    <Plus className="mr-1.5 size-3.5" />
                    Add Article
                  </Button>
                )}
              </div>

              {/* P3c — LLM re-classification audit. Gated on manage_domains, since
                  this changes domain assignment (the same capability as the
                  Domains & Routing engine). */}
              {canManageDomains && (
                <ReclassifyPanel onApplied={() => { void loadList(chip, query); void loadBrowse(); }} />
              )}

              <Card className="rounded-2xl border border-[var(--border)] shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900 border-b border-[var(--border)]">
                      <tr className="text-left text-slate-600 dark:text-slate-300">
                        <th className="w-9 px-3 py-3.5">
                          {canManage && items && items.length > 0 && (
                            <input
                              type="checkbox"
                              aria-label="Select all rows on this page"
                              checked={items.every((a) => selected.has(a.page_id))}
                              onChange={(e) => {
                                const next = new Set(selected);
                                items.forEach((a) => (e.target.checked ? next.add(a.page_id) : next.delete(a.page_id)));
                                setSelected(next);
                              }}
                              className="size-3.5 rounded border-slate-300 align-middle"
                            />
                          )}
                        </th>
                        {([
                          { k: "title", l: "Article Title", cls: "px-5 py-3.5 font-semibold" },
                          { k: null, l: "Source", cls: "px-4 py-3.5 font-semibold" },
                          { k: "domain", l: "Domain", cls: "px-4 py-3.5 font-semibold" },
                          { k: "last_synced", l: "Synced", cls: "px-4 py-3.5 font-semibold" },
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
                                className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
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
                        <th className="px-5 py-3.5 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listing ? (
                        <tr>
                          <td colSpan={6} className="p-4">
                            <Skeleton className="h-9 w-full rounded-lg" />
                          </td>
                        </tr>
                      ) : !items || items.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <span className="text-xs">No articles match this filter.</span>
                              {canManageDomains && (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/60 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
                                  onClick={() => { setChip("all"); setProviderFilter("all"); setQuery(""); void loadList("all", "", 0); }}
                                >
                                  <Sparkles className="size-3" /> Clear filters, or run Re-classify KB
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        items.map((article) => {
                          const meta = metaFor(article.domain);
                          return (
                            <tr key={article.page_id} className={`border-t border-[var(--border)]/60 transition hover:bg-slate-50/70 dark:hover:bg-slate-900/60 ${selected.has(article.page_id) ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}>
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
                                    className="size-3.5 rounded border-slate-300 align-middle"
                                  />
                                )}
                              </td>
                              <td className="max-w-[400px] truncate px-5 py-3 font-medium text-slate-900 dark:text-white">
                                {/* P1#8 — show WHERE the search text matched so the
                                    result does not look arbitrary. */}
                                {query.trim() ? highlight(article.title, query) : article.title}
                              </td>
                              <td className="px-4 py-3">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${providerOf(article).className}`}
                                  title={article.source_url || undefined}
                                >
                                  {providerOf(article).label}
                                </Badge>
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant="outline" className="text-[10px] capitalize bg-slate-50 dark:bg-slate-800">
                                  {meta.label}
                                </Badge>
                              </td>
                              <td
                                className="px-4 py-3 text-muted-foreground text-[11px]"
                                title={article.last_synced ? new Date(article.last_synced).toLocaleString() : "never synced"}
                              >
                                {relTime(article.last_synced)}
                              </td>
                              <td className="px-5 py-3 text-right">
                                <div className="flex justify-end gap-1.5 items-center">
                                  {article.source_url && (
                                    <a
                                      href={article.source_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-md p-1 text-slate-400 hover:text-blue-600 transition"
                                      title="Open source URL"
                                    >
                                      <ExternalLink className="size-3.5" />
                                    </a>
                                  )}
                                  {canManage && (
                                    <button
                                      type="button"
                                      onClick={() => handleDelete(article.page_id, article.title)}
                                      className="rounded-md p-1 text-slate-400 hover:text-rose-600 transition"
                                      title="Delete article"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* P1#9 — server-side pagination. `total` is COUNT(*) over the whole
                    filtered KB and the page size is selectable, so "1-N of TOTAL" is a
                    real statement. The table previously hardcoded 8 rows per page while
                    the API returned 50. */}
                {items && kbTotal != null && kbTotal > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3 bg-muted/20">
                    <p className="text-[11px] text-muted-foreground">
                      Showing {(page - 1) * pageSize + 1}–{Math.min((page - 1) * pageSize + items.length, kbTotal)} of {kbTotal}
                    </p>
                    <div className="flex items-center gap-2">
                      <select
                        value={pageSize}
                        onChange={(e) => { setPageSize(Number(e.target.value)); setSelected(new Set()); void loadList(chip, query, 0); }}
                        className="h-7 rounded-lg border border-[var(--border)] bg-white px-2 text-[11px] dark:bg-slate-900"
                        title="Rows per page"
                      >
                        {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}
                      </select>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline" size="sm" className="h-7 w-7 p-0 text-xs rounded-lg"
                          disabled={page <= 1 || listing}
                          onClick={() => { setSelected(new Set()); void loadList(chip, query, (page - 2) * pageSize); }}
                        >
                          ‹
                        </Button>
                        {(() => {
                          const totalPages = Math.max(1, Math.ceil(kbTotal / pageSize));
                          const nums: (number | "…")[] = [];
                          if (totalPages <= 7) {
                            for (let i = 1; i <= totalPages; i++) nums.push(i);
                          } else {
                            nums.push(1);
                            if (page > 3) nums.push("…");
                            for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) nums.push(i);
                            if (page < totalPages - 2) nums.push("…");
                            nums.push(totalPages);
                          }
                          return nums.map((n, idx) =>
                            n === "…" ? (
                              <span key={`e${idx}`} className="px-1 text-[11px] text-muted-foreground">…</span>
                            ) : (
                              <Button
                                key={n}
                                variant={n === page ? "default" : "outline"}
                                size="sm"
                                className="h-7 min-w-7 px-2 text-[11px] rounded-lg"
                                disabled={listing}
                                onClick={() => { setSelected(new Set()); void loadList(chip, query, (Number(n) - 1) * pageSize); }}
                              >
                                {n}
                              </Button>
                            ),
                          );
                        })()}
                        <Button
                          variant="outline" size="sm" className="h-7 w-7 p-0 text-xs rounded-lg"
                          disabled={page >= Math.ceil(kbTotal / pageSize) || listing}
                          onClick={() => { setSelected(new Set()); void loadList(chip, query, page * pageSize); }}
                        >
                          ›
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {/* Quick sync & integration summary footer */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="rounded-xl border border-[var(--border)] bg-card p-3.5 text-xs shadow-xs">
                <div className="flex items-center gap-2 text-slate-900 dark:text-white font-medium mb-1">
                  <Clock3 className="size-3.5 text-blue-600" />
                  Automatic Background Sync
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Scheduled beat interval runs every {status?.beat_interval_minutes ?? 30} minutes via Celery worker.
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-card p-3.5 text-xs shadow-xs">
                <div className="flex items-center gap-2 text-slate-900 dark:text-white font-medium mb-1">
                  <Check className="size-3.5 text-emerald-600" />
                  RAG Vector Index Status
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  PGVector embeddings synced with LangGraph hybrid keyword + semantic retrieval.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ==============================================================
            TAB 2: DOMAINS & ROUTING ENGINE (FULL WIDTH)
        ============================================================== */}
        {activeTab === "domains" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Layers className="size-4 text-indigo-600 dark:text-indigo-400" />
                  Domains & Routing Engine Configuration
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Classifier keywords, domain icons, colors, and Jira escalation routing rules
                </p>
              </div>
              <Badge variant="outline" className="text-xs bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-900 px-3 py-1">
                {classifierDomains.length} Active Domains
              </Badge>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-card shadow-xs overflow-hidden">
              {domainsError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 text-xs border-b border-rose-200 dark:border-rose-900">
                  {domainsError}
                </div>
              )}

              {domainsLoading && classifierDomains.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-xs">Loading domains configuration...</div>
              ) : (
                <DomainClassifierManager
                  domains={classifierDomains}
                  onRefresh={loadClassifierData}
                  canManage={canManageDomains}
                />
              )}
            </div>
          </div>
        )}
      </main>

      {/* ==========================================================
          ADD / EDIT ARTICLE DIALOG
      ========================================================== */}
      <Dialog
        open={!!edit}
        onOpenChange={(open) => {
          if (!open) setEdit(null);
        }}
      >
        <DialogContent className="max-w-xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {edit?.page_id.startsWith("manual-") ? "Add Article" : "Edit Article"}
            </DialogTitle>
          </DialogHeader>

          {edit && (
            <div className="space-y-4 py-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium">Title</label>
                <input
                  value={edit.title}
                  onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                  placeholder="Article title"
                  className="h-10 w-full rounded-xl border bg-background px-3 text-xs outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium">Domain</label>
                <select
                  value={edit.domain}
                  onChange={(e) => setEdit({ ...edit, domain: e.target.value })}
                  className="h-10 w-full rounded-xl border bg-background px-3 text-xs outline-none focus:border-blue-500"
                >
                  {chips
                    .filter((x) => x !== "all")
                    .map((x) => (
                      <option key={x} value={x}>
                        {metaFor(x).label}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="block text-xs font-medium">Body / Content</label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] text-blue-600 px-2"
                    onClick={async () => {
                      if (!edit.title.trim()) {
                        onToast("Please enter a title first", "err");
                        return;
                      }
                      try {
                        const draft = await articleDraft(edit.title, edit.domain);
                        if (draft?.body) {
                          setEdit({ ...edit, body: draft.body });
                          onToast("AI draft generated");
                        }
                      } catch {
                        onToast("Failed to generate draft", "err");
                      }
                    }}
                  >
                    <Sparkles className="mr-1 size-3" />
                    Auto-draft with AI
                  </Button>
                </div>
                <textarea
                  value={edit.body}
                  onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                  placeholder="Article markdown or plain text content..."
                  rows={8}
                  className="w-full rounded-xl border bg-background p-3 text-xs outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={busy || !edit?.title.trim()}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {busy && <RefreshCw className="mr-2 size-3.5 animate-spin" />}
              Save Article
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
