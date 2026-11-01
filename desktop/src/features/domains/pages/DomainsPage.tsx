/**
 * Domains & Routing Engine — its own page.
 *
 * This view used to be TAB 2 of the Knowledge page. Tabs forced one shared header, one
 * scroll position and one URL for two unrelated jobs: reading KB articles, and editing the
 * classifier that decides where a question is routed. They are separate pages now, and
 * `KnowledgePage` keeps only the articles half.
 *
 * Layout follows the workspace mockup: ADMINISTRATION eyebrow + breadcrumb header, three
 * equal figures counted from the API, a two-step explainer band, then one panel that holds
 * the whole routing table with its own search / status filter / Reset and a range footer.
 * The panel chrome lives here so `DomainClassifierManager` can render the list alone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BookOpen, Layers, Plus, Route, Search, ShieldAlert, Ticket, Workflow } from "lucide-react";
import { EmptyState, ErrorState, PageShell, PageHeader } from "@/components/ui/page";
import { ClassifierDomainItem, getClassifierDomains } from "@/features/domains/api";
import { DomainClassifierManager } from "@/features/domains/components/DomainClassifierManager";

/** One figure per card, every one of them counted from the list the API returned. */
function StatCard({
  icon,
  value,
  title,
  caption,
  loading,
}: {
  icon: React.ReactNode;
  value: string;
  title: string;
  caption: string;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-card p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs text-muted-foreground">{title}</span>
        <span className="text-[var(--primary)]">{icon}</span>
      </div>
      <div className="mt-2.5 text-3xl font-semibold tracking-tight">
        {loading ? <div className="h-8 w-14 animate-pulse rounded bg-muted" /> : value}
      </div>
      <p className="mt-1.5 text-2xs leading-tight text-muted-foreground">{caption}</p>
    </div>
  );
}

/** The two halves of what a domain actually does, side by side and at equal height. */
function ConceptCard({
  icon,
  step,
  title,
  tone,
  children,
}: {
  icon: React.ReactNode;
  step: string;
  title: string;
  tone: "sky" | "indigo";
  children: React.ReactNode;
}) {
  const toneCls = {
    sky: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
    indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
  }[tone];

  return (
    <div className="flex gap-3.5">
      <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${toneCls}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
          {step}
        </div>
        <strong className="mt-1 block text-xs">{title}</strong>
        <p className="mt-1.5 max-w-[500px] text-xs leading-relaxed text-muted-foreground">
          {children}
        </p>
      </div>
    </div>
  );
}

export default function DomainsPage({
  role,
  perms,
}: {
  role?: string;
  perms?: Record<string, boolean>;
}) {
  const [domains, setDomains] = useState<ClassifierDomainItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Panel-level filters — the mockup puts search + status + Reset in the panel toolbar.
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive">("");

  // Bumped by the header's "Add domain" button; the manager watches it and opens its form.
  const [createSignal, setCreateSignal] = useState(0);

  // "Test keywords" — runs the classifier's own keyword rules locally, no backend call.
  const [testerOpen, setTesterOpen] = useState(false);
  const [question, setQuestion] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);

  // v1.1.1 — domain_manager merged into knowledge (Knowledge Manager role)
  const canManage =
    role === "admin" ||
    role === "knowledge" ||
    role === "domain_manager" ||
    !!perms?.manage_domains ||
    !!perms?.manage_users;

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getClassifierDomains();
      setDomains(res.domains || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load domain configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) {
      loadData();
    }
  }, [canManage, loadData]);

  // Counted from the list the API returned — never a placeholder figure.
  const totals = useMemo(
    () => ({
      active: domains.filter((d) => d.is_active).length,
      keywords: domains.reduce((n, d) => n + (d.keywords?.length ?? 0), 0),
      routed: domains.filter((d) => !!d.jira_project).length,
    }),
    [domains],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return domains.filter((d) => {
      if (statusFilter === "active" && !d.is_active) return false;
      if (statusFilter === "inactive" && d.is_active) return false;
      if (!needle) return true;
      const hay = [d.display_name, d.domain_key, d.jira_project ?? "", ...(d.keywords ?? [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [domains, q, statusFilter]);

  const filtered = q.trim() !== "" || statusFilter !== "";

  // Same rule the backend classifier applies: case-insensitive substring match, most
  // matches first. This is a preview of the keyword rules only — not a live classification.
  const matches = useMemo(() => {
    const needle = question.trim().toLowerCase();
    if (!needle) return [];
    return domains
      .filter((d) => d.is_active)
      .map((d) => ({
        domain: d,
        hits: (d.keywords ?? []).filter((k) => k && needle.includes(k.toLowerCase())),
      }))
      .filter((m) => m.hits.length > 0)
      .sort((a, b) => b.hits.length - a.hits.length);
  }, [domains, question]);

  if (!canManage) {
    return (
      <PageShell>
        <PageHeader
          icon={<Layers className="size-5" />}
          title="Domains & Routing Engine"
          description="Classifier keywords, domain icons, colours, and Jira escalation routing"
        />
        <main className="mx-auto max-w-4xl">
          <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--border)] bg-card p-12 text-center shadow-xs">
            <div className="mb-4 rounded-full bg-rose-50 p-3 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
              <ShieldAlert className="size-8" />
            </div>
            <h3 className="text-base font-semibold">Access restricted</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Only the Administrator and Knowledge Manager roles may view or change routing
              domains and classification rules.
            </p>
          </div>
        </main>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        breadcrumbs={["Workspace", "Domains & routing"]}
        title="Domains & routing"
        description="Connect every question to the right knowledge and the right team."
        actions={
          <>
            <button
              type="button"
              onClick={() => setTesterOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              <Search className="size-3.5" /> Test keywords
            </button>
            <button
              type="button"
              onClick={() => setCreateSignal((n) => n + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90"
            >
              <Plus className="size-3.5" /> Add domain
            </button>
          </>
        }
      />

      <main className="space-y-6">
        {/* Three equal cards, one figure each, counted from the API response. */}
        <section className="grid auto-rows-fr gap-4 md:grid-cols-3">
          <StatCard
            icon={<Layers className="size-4" />}
            value={String(totals.active)}
            title="Active domains"
            caption="Available to the classifier"
            loading={loading}
          />
          <StatCard
            icon={<Workflow className="size-4" />}
            value={String(totals.keywords)}
            title="Classifier keywords"
            caption="Across configured domains"
            loading={loading}
          />
          <StatCard
            icon={<Route className="size-4" />}
            value={String(totals.routed)}
            title="Jira routes"
            caption="Configured escalation targets"
            loading={loading}
          />
        </section>

        {/* The two halves of a domain's job, side by side at equal height. */}
        <section className="grid items-center gap-5 rounded-xl border border-[var(--border)] bg-muted/30 px-6 py-5 md:grid-cols-[1fr_auto_1fr]">
          <ConceptCard tone="sky" step="01 / Find an answer" title="Retrieve from Confluence" icon={<BookOpen className="size-4" />}>
            Keywords select a domain. The assistant retrieves that domain's knowledge base
            articles to answer the question.
          </ConceptCard>
          <ArrowRight className="mx-auto hidden size-5 text-muted-foreground md:block" />
          <ConceptCard tone="indigo" step="02 / Escalate when needed" title="Route to the right Jira project" icon={<Ticket className="size-4" />}>
            When a question is unanswered and the user requests a human, create a ticket in the
            domain's mapped Jira project.
          </ConceptCard>
        </section>

        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-card shadow-xs">
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <h2 className="text-sm font-semibold">
              Routing domains
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-2xs font-normal text-muted-foreground">
                {domains.length} configured
              </span>
            </h2>
            <span className="text-2xs text-muted-foreground">
              {role === "admin" ? "Administrator" : "Knowledge Manager"}
            </span>
          </div>

          <div className="flex flex-wrap gap-2.5 px-5 pb-4">
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search domains"
              placeholder="Search domains, keywords, or Jira project…"
              className="min-w-[180px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--field,var(--background))] px-3 py-2 text-xs outline-none focus:border-[var(--primary)]"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "" | "active" | "inactive")}
              aria-label="Filter status"
              className="rounded-lg border border-[var(--border)] bg-[var(--field,var(--background))] px-3 py-2 text-xs outline-none focus:border-[var(--primary)]"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button
              type="button"
              onClick={() => {
                setQ("");
                setStatusFilter("");
              }}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-muted"
            >
              Reset
            </button>
          </div>

          {/* An error banner ABOVE a rendered manager was the old behaviour, so the user
              saw "failed to load" and a working-looking table at the same time. Failure
              now replaces the content, because there is nothing truthful to show under it. */}
          {loading && domains.length === 0 ? (
            <div className="space-y-2 border-t border-[var(--border)] p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-11 animate-pulse rounded-lg bg-muted"
                  style={{ width: `${88 + ((i * 7) % 12)}%` }}
                />
              ))}
            </div>
          ) : error ? (
            <ErrorState title="Could not load the domains configuration" detail={error} onRetry={loadData} />
          ) : domains.length === 0 ? (
            <EmptyState
              icon={<Layers className="size-5" />}
              title="No domains configured yet"
              description="Domains group your knowledge and route questions to the right collection. Add one to start classifying incoming content."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<Layers className="size-5" />}
              title="No domains match your filters"
              description={`${domains.length} domain${domains.length === 1 ? "" : "s"} configured, but none match the current search or status filter.`}
            />
          ) : (
            <div className="border-t border-[var(--border)]">
              <DomainClassifierManager
                domains={visible}
                onRefresh={loadData}
                canManage={canManage}
                hideHeader
                openCreateSignal={createSignal}
              />
            </div>
          )}

          {!loading && !error && domains.length > 0 && (
            <div className="border-t border-[var(--border)] px-5 py-3 text-2xs text-muted-foreground">
              Showing {visible.length} of {domains.length} configured domain
              {domains.length === 1 ? "" : "s"}
              {filtered ? " (filtered)" : ""} · {totals.keywords} classifier keyword
              {totals.keywords === 1 ? "" : "s"} across {totals.active} active domain
              {totals.active === 1 ? "" : "s"}
            </div>
          )}
        </section>

        <p className="text-2xs leading-relaxed text-muted-foreground">
          Edits and keyword tests run against the live classifier configuration. Renaming a
          domain key cascades to its knowledge base articles and vectors.
        </p>
      </main>

      {/* Test keywords — a local preview of the keyword rules, no backend round-trip. */}
      {testerOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Test keyword matching"
          onClick={(e) => {
            if (e.target === e.currentTarget) setTesterOpen(false);
          }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-card p-6 shadow-xl">
            <h2 className="text-base font-semibold">Test keyword matching</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              A case-insensitive match against the keywords of active domains. This previews the
              keyword rules only — it does not reproduce the production classifier or query
              Confluence.
            </p>
            <label className="mt-4 block text-xs font-medium">
              Question
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="For example: postgres connection refused"
                rows={3}
                className="mt-2 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--field,var(--background))] px-3 py-2 text-xs outline-none focus:border-[var(--primary)]"
              />
            </label>

            <div className="mt-4 rounded-lg border border-[var(--border)] bg-muted/40 p-3 text-xs leading-relaxed">
              {question.trim() === "" ? (
                <span className="text-muted-foreground">
                  Enter a question to see matching domains and Jira targets.
                </span>
              ) : matches.length === 0 ? (
                <span className="text-muted-foreground">
                  No keyword matches. The production classifier also applies fallback rules that
                  are not shown here.
                </span>
              ) : (
                <>
                  {matches.map(({ domain, hits }) => (
                    <div key={domain.id} className="mb-2 last:mb-0">
                      <strong>{domain.display_name}</strong>{" "}
                      <span className="text-muted-foreground">
                        → {domain.jira_project || "No Jira route"}
                      </span>
                      <br />
                      Matched: {hits.join(", ")}
                    </div>
                  ))}
                  <span className="text-2xs text-muted-foreground">
                    Multiple matches are shown without assigning production confidence scores.
                  </span>
                </>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={() => setTesterOpen(false)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-muted"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
