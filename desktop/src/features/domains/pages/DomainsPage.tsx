/**
 * Domains & Routing Engine — its own page.
 *
 * This view used to be TAB 2 of the Knowledge page. Tabs forced one shared header, one
 * scroll position and one URL for two unrelated jobs: reading KB articles, and editing the
 * classifier that decides where a question is routed. They are separate pages now, and
 * `KnowledgePage` keeps only the articles half.
 *
 * Card layout follows the dashboard: equal columns, equal heights (`items-stretch` +
 * `auto-rows-fr`), so no card is left orphaned on its own row.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Layers, Route, ShieldAlert, Ticket, Workflow } from "lucide-react";
import { EmptyState, ErrorState, PageShell, PageHeader } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { ClassifierDomainItem, getClassifierDomains } from "@/features/domains/api";
import { DomainClassifierManager } from "@/features/domains/components/DomainClassifierManager";

/** One figure per card, every one of them counted from the list the API returned. */
function StatCard({
  icon,
  value,
  title,
  description,
  tone,
  loading,
}: {
  icon: React.ReactNode;
  value: string;
  title: string;
  description: string;
  tone: "indigo" | "sky" | "amber";
  loading: boolean;
}) {
  const toneCls = {
    indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
    sky: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  }[tone];

  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xl font-semibold tracking-tight">
            {loading ? <div className="h-7 w-12 animate-pulse rounded bg-muted" /> : value}
          </div>
          <div className="mt-1 text-xs font-medium">{title}</div>
        </div>
        <div className={`grid size-8 shrink-0 place-items-center rounded-lg ${toneCls}`}>{icon}</div>
      </div>
      <p className="mt-auto pt-2 text-2xs leading-tight text-muted-foreground">{description}</p>
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
    sky: {
      tile: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
      step: "text-sky-700 dark:text-sky-300",
      card: "border-sky-100 bg-sky-50/50 dark:border-sky-900/40 dark:bg-sky-950/20",
    },
    indigo: {
      tile: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
      step: "text-indigo-700 dark:text-indigo-300",
      card: "border-indigo-100 bg-indigo-50/50 dark:border-indigo-900/40 dark:bg-indigo-950/20",
    },
  }[tone];

  return (
    <div className={`flex flex-col rounded-xl border p-4 text-xs ${toneCls.card}`}>
      <div className="flex items-center gap-2">
        <div className={`grid size-7 shrink-0 place-items-center rounded-lg ${toneCls.tile}`}>{icon}</div>
        <div className="min-w-0">
          <div className={`text-2xs font-semibold uppercase tracking-wide ${toneCls.step}`}>{step}</div>
          <h5 className="text-xs font-semibold leading-tight">{title}</h5>
        </div>
      </div>
      <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-300">{children}</p>
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
        icon={<Layers className="size-5" />}
        badge={role === "admin" ? "Administrator" : "Knowledge Manager"}
        title="Domains & Routing Engine"
        description="Classifier keywords, domain icons, colours, and Jira escalation routing"
        actions={
          <Badge
            variant="outline"
            className="border-indigo-200 bg-indigo-50/60 px-3 py-1 text-xs text-indigo-600 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-400"
          >
            {domains.length} domain{domains.length === 1 ? "" : "s"} configured
          </Badge>
        }
      />

      <main className="space-y-5">
        {/* Three equal cards, one figure each. */}
        <section className="grid auto-rows-fr gap-4 md:grid-cols-3">
          <StatCard
            tone="indigo"
            icon={<Layers className="size-4" />}
            value={String(totals.active)}
            title="Active domains"
            description="Domains the classifier may route to"
            loading={loading}
          />
          <StatCard
            tone="sky"
            icon={<Workflow className="size-4" />}
            value={String(totals.keywords)}
            title="Classifier keywords"
            description="Matched against every incoming question"
            loading={loading}
          />
          <StatCard
            tone="amber"
            icon={<Route className="size-4" />}
            value={String(totals.routed)}
            title="Jira routes"
            description="Domains that escalate to a Jira project"
            loading={loading}
          />
        </section>

        {/* The two halves of a domain's job, side by side at equal height. */}
        <section className="grid auto-rows-fr gap-4 md:grid-cols-2">
          <ConceptCard
            tone="sky"
            step="Step 1"
            title="Knowledge base (answer retrieval)"
            icon={<BookOpen className="size-3.5" />}
          >
            Keyword matching in the user's question selects a domain, and the assistant
            retrieves the <strong>Confluence KB articles</strong> filed under that domain to
            answer from.
          </ConceptCard>
          <ConceptCard
            tone="indigo"
            step="Step 2"
            title="Jira routing (escalation target)"
            icon={<Ticket className="size-3.5" />}
          >
            When the question cannot be answered and the user asks for a human, the ticket is
            created in the domain's <strong>Jira project key</strong> (for example ITHD) for IT
            follow-up.
          </ConceptCard>
        </section>

        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-card shadow-xs">
          {/* An error banner ABOVE a rendered manager was the old behaviour, so the user
              saw "failed to load" and a working-looking table at the same time. Failure
              now replaces the content, because there is nothing truthful to show under it. */}
          {loading && domains.length === 0 ? (
            <div className="space-y-2 p-5">
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
          ) : (
            <DomainClassifierManager domains={domains} onRefresh={loadData} canManage={canManage} />
          )}
        </section>
      </main>
    </PageShell>
  );
}
