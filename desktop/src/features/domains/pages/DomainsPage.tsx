import { useEffect, useState, useCallback } from "react";
import { Layers, ShieldAlert } from "lucide-react";
import { PageShell, PageHeader } from "@/components/ui/page";
import { ClassifierDomainItem, getClassifierDomains } from "@/features/domains/api";
import { DomainClassifierManager } from "@/features/domains/components/DomainClassifierManager";

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

  if (!canManage) {
    return (
      <PageShell>
        <PageHeader
          icon={<Layers className="size-6 text-emerald-600 dark:text-emerald-400" />}
          title="Domain Manager"
          description="Manage routing domains, keywords, and classifier thresholds"
        />
        <main className="mx-auto max-w-4xl p-6">
          <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-full text-rose-600 mb-4">
              <ShieldAlert className="size-8" />
            </div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Access Restricted</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-md">
              Only Administrator and Knowledge Manager roles are authorized to access and modify routing domains and classification rules.
            </p>
          </div>
        </main>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        icon={<Layers className="size-6 text-emerald-600 dark:text-emerald-400" />}
        title="Domain Manager"
        badge={role === "admin" ? "Administrator" : "Knowledge Manager"}
        description="Live management of classification domains, dynamic keyword matching, and Jira routes."
      />

      <main className="mx-auto max-w-[1400px] p-6">
        {/* Quick Guide for Domain Managers */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 text-xs">
            <h5 className="font-semibold text-sky-900 dark:text-sky-300 flex items-center gap-1.5 mb-1.5">
              <span>📖</span> 1. Confluence Knowledge Base (Answer Retrieval)
            </h5>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Based on keyword matching in user queries, the assistant automatically retrieves and references relevant <strong>Confluence KB Articles</strong> within this domain to formulate answers.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 text-xs">
            <h5 className="font-semibold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5 mb-1.5">
              <span>🎫</span> 2. Jira Ticket Routing (Escalation Target)
            </h5>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              When a query cannot be resolved automatically and the user requests escalation, tickets are routed to the assigned <strong>Jira Project Key (e.g. ITHD)</strong> for human IT follow-up.
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          {error && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/40 text-rose-600 text-sm border-b border-rose-200 dark:border-rose-900">
              {error}
            </div>
          )}

          {loading && domains.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">Loading domains configuration...</div>
          ) : (
            <DomainClassifierManager
              domains={domains}
              onRefresh={loadData}
              canManage={canManage}
            />
          )}
        </div>
      </main>
    </PageShell>
  );
}
