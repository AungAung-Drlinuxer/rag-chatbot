import React, { useState } from "react";
import { Plus, Tag, Trash2, Edit2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import {
  ClassifierDomainItem,
  createClassifierDomain,
  updateClassifierDomain,
  deleteClassifierDomain,
} from "@/features/domains/api";

interface Props {
  domains: ClassifierDomainItem[];
  onRefresh: () => void;
  canManage: boolean;
}

export function DomainClassifierManager({ domains, onRefresh, canManage }: Props) {
  const [editingDomain, setEditingDomain] = useState<ClassifierDomainItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form states
  const [domainKey, setDomainKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [jiraProject, setJiraProject] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCreate = () => {
    setIsCreating(true);
    setEditingDomain(null);
    setDomainKey("");
    setDisplayName("");
    setDescription("");
    setJiraProject("");
    setKeywordsText("");
    setIsActive(true);
    setError(null);
  };

  const startEdit = (d: ClassifierDomainItem) => {
    setEditingDomain(d);
    setIsCreating(false);
    setDomainKey(d.domain_key);
    setDisplayName(d.display_name);
    setDescription(d.description || "");
    setJiraProject(d.jira_project || "");
    setKeywordsText(d.keywords.join(", "));
    setIsActive(d.is_active);
    setError(null);
  };

  const cancelForm = () => {
    setIsCreating(false);
    setEditingDomain(null);
    setError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const kwList = keywordsText
      .split(/[\n,]+/)
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 0);

    try {
      if (isCreating) {
        if (!domainKey.trim() || !displayName.trim()) {
          throw new Error("Domain key and Display name are required.");
        }
        await createClassifierDomain({
          domain_key: domainKey.trim().toLowerCase(),
          display_name: displayName.trim(),
          description: description.trim() || undefined,
          keywords: kwList,
          jira_project: jiraProject.trim() || undefined,
          is_active: isActive,
        });
      } else if (editingDomain) {
        await updateClassifierDomain(editingDomain.id, {
          display_name: displayName.trim(),
          description: description.trim() || undefined,
          keywords: kwList,
          jira_project: jiraProject.trim() || undefined,
          is_active: isActive,
        });
      }
      onRefresh();
      cancelForm();
    } catch (err: any) {
      setError(err.message || "Failed to save domain");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (d: ClassifierDomainItem) => {
    if (!confirm(`Are you sure you want to delete or deactivate domain "${d.display_name}"?`)) return;
    try {
      await deleteClassifierDomain(d.id);
      onRefresh();
    } catch (err: any) {
      alert(err.message || "Failed to delete domain");
    }
  };

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Configured Routing Domains</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time keyword triggers, domain classifier thresholds, and Jira escalation project mapping.
          </p>
        </div>
        {canManage && !isCreating && !editingDomain && (
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Domain
          </button>
        )}
      </div>

      {/* Form (Create / Edit) */}
      {(isCreating || editingDomain) && (
        <form onSubmit={handleSave} className="p-6 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-indigo-200 dark:border-indigo-900/50 m-6 space-y-4">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              {isCreating ? "Add New Domain" : `Edit Domain: ${editingDomain?.display_name}`}
            </h5>
            <span className="text-2xs text-slate-400">Changes apply immediately to classification engine</span>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-2.5 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/40 rounded-lg border border-rose-200 dark:border-rose-900">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Domain Key (Unique Identifier)
              </label>
              <input
                type="text"
                disabled={!isCreating}
                value={domainKey}
                onChange={(e) => setDomainKey(e.target.value)}
                placeholder="e.g. hr, sap, hardware"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white disabled:opacity-50"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Human Resources & Benefits"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Jira Project Key (မဖြေနိုင်ပါက Ticket လွှဲပို့မည့် Project)
              </label>
              <input
                type="text"
                value={jiraProject}
                onChange={(e) => setJiraProject(e.target.value)}
                placeholder="e.g. ITDB, ITNET (မသုံးပါက ကွက်လပ်ထားပါ)"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              />
              <p className="text-2xs text-slate-400 mt-1">
                Confluence KB တွင် အဖြေမတွေ့ပါက လူဆီလွှဲရန် သက်ဆိုင်ရာ Team ၏ Jira Project Code ဖြစ်ပါသည်။
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Status
              </label>
              <label className="inline-flex items-center gap-2 mt-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                />
                <span className="text-xs text-slate-700 dark:text-slate-300">Active (Included in classifier routing)</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Description / Scope
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of issues routed to this domain"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Keywords & Phrases (Comma or newline separated)
            </label>
            <textarea
              rows={3}
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
              placeholder="e.g. payroll, leave request, onboarding, tax deduction"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <p className="text-2xs text-slate-400 mt-1">
              Any user prompt containing these phrases will score towards this domain.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={cancelForm}
              className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
            >
              {loading ? "Saving..." : "Save Domain"}
            </button>
          </div>
        </form>
      )}

      {/* Domain Cards List */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {domains.map((d) => (
          <div key={d.id} className="p-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition">
            <div className="space-y-2 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-slate-900 dark:text-white">{d.display_name}</span>
                <span className="px-2 py-0.5 rounded-full text-2xs font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {d.domain_key}
                </span>
                {d.is_active ? (
                  <span className="inline-flex items-center gap-1 text-2xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-2xs text-slate-400">
                    <XCircle className="w-3 h-3" /> Inactive
                  </span>
                )}
                {d.jira_project && (
                  <span className="px-1.5 py-0.5 rounded text-2xs bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900">
                    Jira: {d.jira_project}
                  </span>
                )}
              </div>

              {d.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400">{d.description}</p>
              )}

              {/* Keywords badge preview */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {d.keywords.map((kw, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60"
                  >
                    <Tag className="w-2.5 h-2.5 opacity-40" />
                    {kw}
                  </span>
                ))}
              </div>
            </div>

            {canManage && (
              <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-center">
                <button
                  type="button"
                  onClick={() => startEdit(d)}
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  title="Edit Domain"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(d)}
                  className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  title="Delete/Deactivate"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
