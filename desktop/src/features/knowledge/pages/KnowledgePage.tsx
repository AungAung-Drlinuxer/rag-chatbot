import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  Database,
  ExternalLink,
  FilePlus2,
  FileText,
  Globe,
  Lock,
  Monitor,
  Pencil,
  Plus,
  RefreshCcw,
  RefreshCw,
  Search,
  Server,
  Settings,
  Trash2,
  X,
  Sparkles,
} from "lucide-react";
import { PageShell, PageHeader } from "@/components/ui/page";
import { ICON_OPTIONS, COLOR_OPTIONS } from "@/features/domains/components/DomainClassifierManager";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  searchArticles,
  createArticle,
  updateArticle,
  deleteArticle,
  triggerSync,
  articleDraft,
  listArticleDomains,
  listRecentArticles,
  getSyncStatus,
  listArticles,
} from "@/features/knowledge/api";

type Props = {
  role: string;
  userName?: string;
  onToast: (msg: string, kind?: "ok" | "err") => void;
};

type DomainCard = {
  domain: string;
  display_name?: string;
  description?: string;
  icon?: string;
  color?: string;
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
    inserted: number;
    updated: number;
    skipped: number;
  } | null;
  healthy: boolean;
  beat_interval_minutes: number;
};

const DOMAIN_META: Record<
  string,
  {
    icon: typeof Database;
    label: string;
    description: string;
    iconClass: string;
    bgClass: string;
  }
> = {
  database: {
    icon: Database,
    label: "Database",
    description: "DB installation, performance, backup, connection issues.",
    iconClass: "text-blue-600",
    bgClass: "bg-blue-50 dark:bg-blue-950/30",
  },
  network: {
    icon: Globe,
    label: "Network",
    description: "Network connectivity, DNS, VPN, firewall.",
    iconClass: "text-emerald-600",
    bgClass: "bg-emerald-50 dark:bg-emerald-950/30",
  },
  security: {
    icon: Lock,
    label: "Security",
    description: "Access control, permissions, MFA, security policies.",
    iconClass: "text-amber-600",
    bgClass: "bg-amber-50 dark:bg-amber-950/30",
  },
  server: {
    icon: Monitor,
    label: "Server",
    description: "Server OS, services, applications, patching, monitoring.",
    iconClass: "text-violet-600",
    bgClass: "bg-violet-50 dark:bg-violet-950/30",
  },
  kubernetes: {
    icon: Cloud,
    label: "Kubernetes",
    description: "K8s, containers, cluster operations.",
    iconClass: "text-sky-600",
    bgClass: "bg-sky-50 dark:bg-sky-950/30",
  },
  storage: {
    icon: Server,
    label: "Storage",
    description: "SAN/NAS, disks, backup targets.",
    iconClass: "text-orange-600",
    bgClass: "bg-orange-50 dark:bg-orange-950/30",
  },
  general: {
    icon: BookOpen,
    label: "General",
    description: "General IT guides and quick reference.",
    iconClass: "text-slate-600",
    bgClass: "bg-slate-100 dark:bg-slate-900",
  },
};

function metaFor(domain?: string, card?: DomainCard) {
  const fallback = DOMAIN_META[domain ?? "general"] ?? DOMAIN_META.general;

  // 1. Resolve dynamic icon if provided in card
  const dynamicIconComp = card?.icon && ICON_OPTIONS[card.icon]?.icon;
  const resolvedIcon = dynamicIconComp || fallback.icon;

  // 2. Resolve dynamic color if provided in card
  const dynamicColorDef = card?.color && COLOR_OPTIONS[card.color];
  const resolvedIconClass = dynamicColorDef ? dynamicColorDef.textClass : fallback.iconClass;
  const resolvedBgClass = dynamicColorDef ? dynamicColorDef.bgClass : fallback.bgClass;

  return {
    icon: resolvedIcon,
    iconClass: resolvedIconClass,
    bgClass: resolvedBgClass,
    label: card?.display_name || fallback.label,
    description: card?.description || fallback.description,
  };
}


function relTime(iso?: string | null) {
  if (!iso) return "—";

  const d = new Date(iso).getTime();
  const mins = Math.max(
    0,
    Math.round((Date.now() - d) / 60000)
  );

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.round(mins / 60);

  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";

  const d = new Date(iso);

  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export default function Knowledge({
  role,
  onToast,
}: Props) {
  const canManage = role === "admin" || role === "agent";

  const [domains, setDomains] =
    useState<DomainCard[] | null>(null);

  const [recent, setRecent] =
    useState<RecentItem[] | null>(null);

  const [items, setItems] =
    useState<ListItem[] | null>(null);

  const [status, setStatus] =
    useState<SyncStatus | null>(null);

  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("all");

  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);

  const [manageOpen, setManageOpen] =
    useState(canManage);

  const [edit, setEdit] = useState<{
    page_id: string;
    title: string;
    domain: string;
    body: string;
  } | null>(null);

  const [page, setPage] = useState(1);

  async function loadBrowse() {
    const [domainResponse, recentResponse, syncResponse] =
      await Promise.all([
        listArticleDomains(),
        listRecentArticles(8),
        getSyncStatus(),
      ]);

    setDomains(domainResponse.domains ?? []);
    setRecent(recentResponse.articles ?? []);
    setStatus(syncResponse);
  }

  async function loadList(domain: string, q = "") {
    setListing(true);

    try {
      const params = new URLSearchParams({
        limit: "50",
      });

      if (domain !== "all") {
        params.set("domain", domain);
      }

      if (q.trim()) {
        params.set("q", q.trim());
      }

      const response = await listArticles(params.toString());

      setItems(response.articles ?? []);
    } finally {
      setListing(false);
    }
  }

  useEffect(() => {
    loadBrowse().catch(() => {
      setDomains([]);
      setRecent([]);
      setStatus(null);
    });
  }, []);

  useEffect(() => {
    if (!manageOpen) return;

    loadList(chip, "").catch(() => {
      setItems([]);
      setListing(false);
    });
  }, [manageOpen, chip]);

  const chips = useMemo(() => {
    const names = (domains ?? []).map(
      (item) => item.domain
    );

    return [
      "all",
      ...names.filter((name) => name !== "all"),
    ];
  }, [domains]);

  async function handleSearch(
    event: React.FormEvent
  ) {
    event.preventDefault();

    if (!query.trim()) return;

    setBusy(true);

    try {
      const result = await searchArticles(
        query.trim(),
        chip === "all" ? undefined : chip
      );

      const articles =
        result.data?.articles ?? [];

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

      setManageOpen(true);
      setPage(1);

      onToast(
        `${articles.length} search results found`
      );
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

      if (manageOpen) {
        await loadList(chip);
      }
    } catch {
      onToast("Sync failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(
    pageId: string,
    title: string
  ) {
    if (!confirm(`Delete "${title}"?`)) {
      return;
    }

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
    if (!edit) return;

    setBusy(true);

    try {
      await updateArticle(edit.page_id, {
        title: edit.title,
        body: edit.body,
        domain: edit.domain,
        page_id: edit.page_id,
      });

      setEdit(null);

      onToast("Article updated");

      await loadBrowse();
      await loadList(chip);
    } catch {
      onToast("Update failed", "err");
    } finally {
      setBusy(false);
    }
  }

    return (
    <PageShell>
      <PageHeader
      icon={<BookOpen className="size-5" />}
      badge={role === "admin" ? "Administrator" : role === "agent" ? "IT Support" : role === "knowledge" ? "Knowledge Manager" : "User"}
        title="Knowledge Base"
        description="Search and manage your IT knowledge base"
        actions={<>
          <div
                className={[
                  "hidden items-center gap-2 rounded-xl border px-3 py-2 md:flex",
                  status?.healthy
                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                    : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
                ].join(" ")}
              >
                <span
                  className={[
                    "size-2 rounded-full",
                    status?.healthy
                      ? "bg-emerald-500"
                      : "bg-amber-500",
                  ].join(" ")}
                />

                <div>
                  <div className="text-[11px] font-semibold">
                    {status?.healthy
                      ? "Knowledge synced"
                      : "Sync pending"}
                  </div>

                  <div className="text-[10px] text-muted-foreground">
                    {status?.last_run
                      ? `Updated ${relTime(
                          status.last_run.at
                        )}`
                      : "No sync"}
                  </div>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={busy}
                onClick={handleSync}
              >
                <RefreshCw
                  className={[
                    "mr-2 size-3.5",
                    busy ? "animate-spin" : "",
                  ].join(" ")}
                />
                Sync now
              </Button>
        </>}
      />

          <div className="mx-auto max-w-[1400px] space-y-5 p-5 lg:p-8">

            {/* =================================================
                SEARCH HERO
            ================================================= */}
            <section className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-blue-50/50 via-card to-indigo-50/30 px-5 py-6 shadow-sm dark:from-blue-950/20 dark:via-card dark:to-indigo-950/20 lg:px-8">

              <div className="mx-auto max-w-4xl text-center">
                <h2 className="text-xl font-semibold tracking-tight text-blue-800 dark:text-blue-300 lg:text-2xl">
                  Find answers in your knowledge base
                </h2>

                <p className="mt-1 text-sm text-muted-foreground">
                  Search across all domains or filter by category
                </p>

                <form
                  onSubmit={handleSearch}
                  className="relative mx-auto mt-5 max-w-3xl"
                >
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                  <input
                    value={query}
                    onChange={(e) =>
                      setQuery(e.target.value)
                    }
                    placeholder="Search for solutions, guidelines, errors, procedures..."
                    className="h-12 w-full rounded-xl border bg-white pl-11 pr-24 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:bg-slate-950"
                  />

                  <Button
                    type="submit"
                    disabled={
                      busy || !query.trim()
                    }
                    className="absolute right-1.5 top-1.5 h-9 rounded-lg px-5"
                  >
                    {busy ? (
                      <RefreshCw className="mr-2 size-3.5 animate-spin" />
                    ) : (
                      <Search className="mr-2 size-3.5" />
                    )}
                    Search
                  </Button>
                </form>

                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {chips.map((domain) => {
                    const active =
                      domain === chip;

                    const label =
                      domain === "all"
                        ? "All Domains"
                        : metaFor(domain).label;

                    return (
                      <button
                        key={domain}
                        type="button"
                        onClick={() => {
                          setChip(domain);
                          setPage(1);
                        }}
                        className={[
                          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                          active
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50 dark:bg-slate-900 dark:text-slate-300",
                        ].join(" ")}
                      >
                        {domain !== "all" &&
                          (() => {
                            const Icon =
                              metaFor(domain).icon;

                            return (
                              <Icon className="size-3.5" />
                            );
                          })()}

                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* =================================================
                BROWSE BY DOMAIN
            ================================================= */}
            <section>
              <SectionTitle
                title="Browse by domain"
                description="Explore knowledge by technical domain"
              />

              {!domains ? (
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
                  {Array.from({
                    length: 8,
                  }).map((_, i) => (
                    <Skeleton
                      key={i}
                      className="h-40 rounded-2xl"
                    />
                  ))}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
                  {domains.map((domain, index) => {
                    const meta = metaFor(
                      domain.domain,
                      domain
                    );

                    const Icon = meta.icon;

                    return (
                      <motion.button
                        key={domain.domain}
                        type="button"
                        initial={{
                          opacity: 0,
                          y: 8,
                        }}
                        animate={{
                          opacity: 1,
                          y: 0,
                        }}
                        transition={{
                          delay: index * 0.03,
                        }}
                        onClick={() => {
                          setChip(domain.domain);
                          setManageOpen(true);
                        }}
                        className="text-left"
                      >
                        <Card className="h-full min-h-[154px] rounded-2xl p-4 transition hover:-translate-y-0.5 hover:shadow-md">

                          <div
                            className={[
                              "mb-3 grid size-10 place-items-center rounded-xl",
                              meta.bgClass,
                            ].join(" ")}
                          >
                            <Icon
                              className={[
                                "size-5",
                                meta.iconClass,
                              ].join(" ")}
                            />
                          </div>

                          <div className="text-sm font-semibold">
                            {meta.label}
                          </div>

                          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                            {meta.description}
                          </p>

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                            <span className="text-[11px] font-semibold whitespace-nowrap">
                              {domain.pages}{" "}
                              <span className="font-normal text-muted-foreground">
                                {domain.pages === 1
                                  ? "page"
                                  : "pages"}
                              </span>
                            </span>

                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                              · {domain.last_synced
                                ? `Synced ${relTime(
                                    domain.last_synced
                                  )}`
                                : "Not synced yet"}
                            </span>
                          </div>
                        </Card>
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* =================================================
                LOWER GRID
            ================================================= */}
            <div className={["grid gap-5", canManage ? "" : "xl:grid-cols-[1.05fr_0.95fr]"].join(" ")}>

              {/* =================================================
                  RECENTLY UPDATED  (v0.21.84 - hidden for managers; the
                  Manage table shows the same list, rendering both was redundant)
              ================================================= */}
              <section className={canManage ? "hidden" : ""}>
                <Card className="overflow-hidden rounded-2xl">

                  <div className="flex items-center justify-between border-b px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/30">
                        <Clock3 className="size-4" />
                      </div>

                      <div>
                        <h2 className="text-sm font-semibold">
                          Recently updated
                        </h2>

                        <p className="text-[11px] text-muted-foreground">
                          Latest changes in the knowledge base
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setManageOpen(true)
                      }
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      View all
                    </button>
                  </div>

                  {!recent ? (
                    <div className="space-y-2 p-4">
                      {Array.from({
                        length: 6,
                      }).map((_, i) => (
                        <Skeleton
                          key={i}
                          className="h-12 rounded-xl"
                        />
                      ))}
                    </div>
                  ) : recent.length === 0 ? (
                    <div className="p-10 text-center text-sm text-muted-foreground">
                      No recently updated articles.
                    </div>
                  ) : (
                    <div className="divide-y">
                      {recent.map(
                        (article, index) => {
                          const meta = metaFor(
                            article.domain
                          );

                          const Icon = meta.icon;

                          const row = (
                            <>
                              <div
                                className={[
                                  "grid size-8 shrink-0 place-items-center rounded-lg",
                                  meta.bgClass,
                                ].join(" ")}
                              >
                                <Icon
                                  className={[
                                    "size-4",
                                    meta.iconClass,
                                  ].join(" ")}
                                />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium">
                                  {article.title}
                                </div>

                                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                                  <span>
                                    Updated by{" "}
                                    {article.updated_by ??
                                      "system"}
                                  </span>

                                  <span>•</span>

                                  <span>
                                    {relTime(
                                      article.last_synced
                                    )}
                                  </span>
                                </div>
                              </div>

                              <Badge
                                variant="outline"
                                className="hidden text-[10px] capitalize sm:inline-flex"
                              >
                                {meta.label}
                              </Badge>

                              {article.source_url && (
                                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                              )}
                            </>
                          );

                          return article.source_url ? (
                            <a
                              href={
                                article.source_url
                              }
                              target="_blank"
                              rel="noreferrer"
                              key={`${article.title}-${index}`}
                              className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-900"
                            >
                              {row}
                            </a>
                          ) : (
                            <div
                              key={`${article.title}-${index}`}
                              className="flex items-center gap-3 px-5 py-3"
                            >
                              {row}
                            </div>
                          );
                        }
                      )}
                    </div>
                  )}
                </Card>
              </section>

              {/* =================================================
                  MANAGE / ADMIN
              ================================================= */}
              {canManage && (
                <section>
                  <Card className="overflow-hidden rounded-2xl">

                    <button
                      type="button"
                      onClick={() =>
                        setManageOpen(!manageOpen)
                      }
                      className="flex w-full items-center justify-between border-b px-5 py-4 text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          <Settings className="size-4" />
                        </div>

                        <div>
                          <h2 className="text-sm font-semibold">
                            Manage knowledge base
                          </h2>

                          <p className="text-[11px] text-muted-foreground">
                            Manage articles and synchronization
                          </p>
                        </div>
                      </div>

                      <ChevronDown
                        className={[
                          "size-4 text-muted-foreground transition-transform",
                          manageOpen
                            ? "rotate-180"
                            : "",
                        ].join(" ")}
                      />
                    </button>

                    {manageOpen && (
                      <div className="p-5">

                        {/* Admin toolbar */}
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <select
                              value={chip}
                              onChange={(e) =>
                                setChip(
                                  e.target.value
                                )
                              }
                              className="h-9 rounded-lg border bg-background px-3 text-xs outline-none focus:border-blue-500"
                            >
                              <option value="all">
                                All Domains
                              </option>

                              {chips
                                .filter(
                                  (x) =>
                                    x !== "all"
                                )
                                .map((x) => (
                                  <option
                                    key={x}
                                    value={x}
                                  >
                                    {metaFor(x).label}
                                  </option>
                                ))}
                            </select>
                          </div>

                          <Button
                            size="sm"
                            className="h-9 rounded-lg"
                            onClick={() =>
                              setEdit({
                                page_id: `manual-${Date.now()}`,
                                title: "",
                                domain: "general",
                                body: "",
                              })
                            }
                          >
                            <Plus className="mr-2 size-3.5" />
                            Add article
                          </Button>
                        </div>

                        {/* Table */}
                        <div className="overflow-hidden rounded-xl border">
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[650px] text-xs">
                              <thead className="bg-slate-50 dark:bg-slate-900">
                                <tr className="text-left">
                                  <th className="px-3 py-3 font-semibold">
                                    Article
                                  </th>

                                  <th className="px-3 py-3 font-semibold">
                                    Domain
                                  </th>

                                  <th className="px-3 py-3 font-semibold">
                                    Updated
                                  </th>

                                  <th className="px-3 py-3 font-semibold">
                                    Updated by
                                  </th>

                                  <th className="px-3 py-3 text-right font-semibold">
                                    Actions
                                  </th>
                                </tr>
                              </thead>

                              <tbody>
                                {listing ? (
                                  <tr>
                                    <td
                                      colSpan={5}
                                      className="p-4"
                                    >
                                      <Skeleton className="h-9 w-full" />
                                    </td>
                                  </tr>
                                ) : !items ||
                                  items.length === 0 ? (
                                  <tr>
                                    <td
                                      colSpan={5}
                                      className="p-8 text-center text-muted-foreground"
                                    >
                                      No articles found.
                                    </td>
                                  </tr>
                                ) : (
                                  items
                                    .slice(
                                      (page - 1) * 5,
                                      page * 5
                                    )
                                    .map(
                                      (article) => {
                                        const meta =
                                          metaFor(
                                            article.domain
                                          );

                                        return (
                                          <tr
                                            key={
                                              article.page_id
                                            }
                                            className="border-t transition hover:bg-slate-50 dark:hover:bg-slate-900/60"
                                          >
                                            <td className="max-w-[260px] truncate px-3 py-3 font-medium">
                                              {
                                                article.title
                                              }
                                            </td>

                                            <td className="px-3 py-3">
                                              <Badge
                                                variant="outline"
                                                className="text-[10px] capitalize"
                                              >
                                                {
                                                  meta.label
                                                }
                                              </Badge>
                                            </td>

                                            <td className="px-3 py-3 text-muted-foreground">
                                              {relTime(
                                                article.last_synced
                                              )}
                                            </td>

                                            <td className="px-3 py-3 text-muted-foreground">
                                              {article.updated_by ??
                                                "—"}
                                            </td>

                                            <td className="px-3 py-3">
                                              <div className="flex justify-end gap-1">
                                                {!article.page_id.startsWith(
                                                  "hit-"
                                                ) && (
                                                  <>
                                                    <button
                                                      type="button"
                                                      title="Edit"
                                                      onClick={() =>
                                                        setEdit(
                                                          {
                                                            page_id:
                                                              article.page_id,
                                                            title:
                                                              article.title,
                                                            domain:
                                                              article.domain,
                                                            body: "",
                                                          }
                                                        )
                                                      }
                                                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800"
                                                    >
                                                      <Pencil className="size-3.5" />
                                                    </button>

                                                    <button
                                                      type="button"
                                                      title="Delete"
                                                      onClick={() =>
                                                        handleDelete(
                                                          article.page_id,
                                                          article.title
                                                        )
                                                      }
                                                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                                                    >
                                                      <Trash2 className="size-3.5" />
                                                    </button>
                                                  </>
                                                )}

                                                {article.source_url && (
                                                  <a
                                                    href={
                                                      article.source_url
                                                    }
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800"
                                                  >
                                                    <ExternalLink className="size-3.5" />
                                                  </a>
                                                )}
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      }
                                    )
                                )}
                              </tbody>
                            </table>
                          </div>

                          {/* Pagination */}
                          <div className="flex items-center justify-between border-t px-3 py-2.5 text-[10px] text-muted-foreground">
                            <span>
                              Showing{" "}
                              {items?.length
                                ? Math.min(
                                    (page - 1) * 5 +
                                      1,
                                    items.length
                                  )
                                : 0}
                              {" "}
                              to{" "}
                              {Math.min(
                                page * 5,
                                items?.length ?? 0
                              )}{" "}
                              of{" "}
                              {items?.length ?? 0}{" "}
                              articles
                            </span>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={
                                  page === 1
                                }
                                onClick={() =>
                                  setPage(
                                    (p) =>
                                      Math.max(
                                        1,
                                        p - 1
                                      )
                                  )
                                }
                                className="grid size-7 place-items-center rounded-md border disabled:opacity-40"
                              >
                                <ChevronLeft className="size-3.5" />
                              </button>

                              <span className="grid size-7 place-items-center rounded-md border border-blue-500 bg-blue-50 font-medium text-blue-600 dark:bg-blue-950/30">
                                {page}
                              </span>

                              <button
                                type="button"
                                disabled={
                                  !items ||
                                  page * 5 >=
                                    items.length
                                }
                                onClick={() =>
                                  setPage(
                                    (p) =>
                                      p + 1
                                  )
                                }
                                className="grid size-7 place-items-center rounded-md border disabled:opacity-40"
                              >
                                <ChevronRight className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Sync health */}
                        <div className="mt-6">
                          <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Activity className="size-4 text-emerald-500" />

                              <div>
                                <div className="text-xs font-semibold">
                                  Sync health
                                </div>

                                <div className="text-[10px] text-muted-foreground">
                                  Confluence synchronization status
                                </div>
                              </div>
                            </div>

                            <Badge
                              variant="outline"
                              className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30"
                            >
                              <span className="mr-1 size-1.5 rounded-full bg-emerald-500" />
                              {status?.healthy
                                ? "Healthy"
                                : "Pending"}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                            <SyncMetric
                              label="Total pages"
                              value={String(
                                status?.pages ?? 0
                              )}
                              icon={
                                <FileText className="size-3.5" />
                              }
                            />

                            <SyncMetric
                              label="Inserted"
                              value={String(
                                status?.last_run
                                  ?.inserted ?? 0
                              )}
                              icon={
                                <FilePlus2 className="size-3.5" />
                              }
                            />

                            <SyncMetric
                              label="Updated"
                              value={String(
                                status?.last_run
                                  ?.updated ?? 0
                              )}
                              icon={
                                <RefreshCcw className="size-3.5" />
                              }
                            />

                            <SyncMetric
                              label="Skipped"
                              value={String(
                                status?.last_run
                                  ?.skipped ?? 0
                              )}
                              icon={
                                <CheckCircle2 className="size-3.5" />
                              }
                            />

                            <SyncMetric
                              label="Next sync"
                              value={`Every ${
                                status?.beat_interval_minutes ??
                                30
                              } min`}
                              icon={
                                <Clock3 className="size-3.5" />
                              }
                            />
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[10px] text-muted-foreground dark:bg-slate-900">
                            <span>
                              Source: Confluence
                            </span>

                            <span>
                              Read-only API
                            </span>

                            <span>
                              Incremental sync
                            </span>

                            <span>
                              Last run:{" "}
                              {status?.last_run
                                ? formatDate(
                                    status.last_run.at
                                  )
                                : "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>
                </section>
              )}
            </div>
          </div>
              {/* ==========================================================
          EDIT DIALOG
      ========================================================== */}
      <Dialog
        open={!!edit}
        onOpenChange={(open) => {
          if (!open) {
            setEdit(null);
          }
        }}
      >
        <DialogContent className="max-w-xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {edit?.page_id.startsWith("manual-")
                ? "Add article"
                : "Edit article"}
            </DialogTitle>
          </DialogHeader>

          {edit && (
            <div className="space-y-4 py-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium">
                  Title
                </label>

                <input
                  value={edit.title}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      title: e.target.value,
                    })
                  }
                  placeholder="Article title"
                  className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium">
                  Domain
                </label>

                <select
                  value={edit.domain}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      domain: e.target.value,
                    })
                  }
                  className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:border-blue-500"
                >
                  {chips
                    .filter(
                      (x) => x !== "all"
                    )
                    .map((x) => (
                      <option key={x} value={x}>
                        {metaFor(x).label}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="block text-xs font-medium">
                    Body
                  </label>
                  <button
                    type="button"
                    disabled={busy || !edit.title.trim()}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const data = await articleDraft(edit.title, edit.domain);
                        if (data.draft) {
                          setEdit({ ...edit, body: data.draft });
                          onToast("AI draft generated");
                        } else {
                          onToast(data.detail || "Draft failed", "err");
                        }
                      } catch {
                        onToast("Draft failed", "err");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium text-blue-600 transition hover:bg-blue-50 disabled:opacity-40 dark:hover:bg-blue-950/30"
                  >
                    <Sparkles className="size-3" />
                    AI assist
                  </button>
                </div>

                <textarea
                  rows={8}
                  value={edit.body}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      body: e.target.value,
                    })
                  }
                  placeholder="Write article content in markdown..."
                  className="w-full resize-none rounded-xl border bg-background px-3 py-3 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEdit(null)}
            >
              <X className="mr-2 size-4" />
              Cancel
            </Button>

            <Button
              onClick={async () => {
                if (!edit) return;

                if (
                  edit.page_id.startsWith(
                    "manual-"
                  )
                ) {
                  try {
                    await createArticle({
                      page_id:
                        edit.page_id,
                      title: edit.title,
                      body: edit.body,
                      domain:
                        edit.domain,
                      source_url: "",
                    });

                    setEdit(null);
                    onToast("Article added");

                    await loadBrowse();
                    await loadList(chip);
                  } catch {
                    onToast(
                      "Add failed",
                      "err"
                    );
                  }

                  return;
                }

                await handleSaveEdit();
              }}
              disabled={
                busy ||
                !edit?.title.trim()
              }
            >
              {busy && (
                <RefreshCw className="mr-2 size-4 animate-spin" />
              )}

              {edit?.page_id.startsWith(
                "manual-"
              )
                ? "Add article"
                : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

/* ==============================================================
   SIDEBAR ITEM
============================================================== */

/* ==============================================================
   SECTION TITLE
============================================================== */

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold tracking-tight">
        {title}
      </h2>

      <p className="mt-1 text-[11px] text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

/* ==============================================================
   SYNC METRIC
============================================================== */

function SyncMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-white p-3 dark:bg-slate-950">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </div>

      <div className="text-sm font-semibold">
        {value}
      </div>
    </div>
  );
}