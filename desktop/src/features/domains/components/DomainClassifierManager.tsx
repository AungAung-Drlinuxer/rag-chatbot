import React, { useState, useRef } from "react";
import {
  Plus,
  Tag,
  Trash2,
  Edit2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Upload,
  Database,
  Network,
  Lock,
  Monitor,
  Cloud,
  Server,
  BookOpen,
  Headphones,
  Boxes,
  Mail,
  Shield,
  Layers,
  Wrench,
  Cpu,
  Key,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  ClassifierDomainItem,
  createClassifierDomain,
  updateClassifierDomain,
  deleteClassifierDomain,
  renameClassifierDomain,
} from "@/features/domains/api";

interface Props {
  domains: ClassifierDomainItem[];
  onRefresh: () => void;
  canManage: boolean;
}

export const ICON_OPTIONS: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  Database: { label: "Database", icon: Database },
  Network: { label: "Network", icon: Network },
  Lock: { label: "Security / Lock", icon: Lock },
  Monitor: { label: "Server / Monitor", icon: Monitor },
  Cloud: { label: "Cloud / K8s", icon: Cloud },
  Server: { label: "Storage / Server", icon: Server },
  Headphones: { label: "Help Desk", icon: Headphones },
  Boxes: { label: "Inventory / Assets", icon: Boxes },
  Mail: { label: "Email", icon: Mail },
  Shield: { label: "Shield / Security", icon: Shield },
  Layers: { label: "Layers / Apps", icon: Layers },
  Wrench: { label: "Wrench / Maintenance", icon: Wrench },
  Cpu: { label: "CPU / Hardware", icon: Cpu },
  Key: { label: "Key / Identity", icon: Key },
  BookOpen: { label: "General / Book", icon: BookOpen },
};

export const COLOR_OPTIONS: Record<
  string,
  { label: string; textClass: string; bgClass: string; borderClass: string; swatchBg: string }
> = {
  blue: {
    label: "Blue",
    textClass: "text-blue-600 dark:text-blue-400",
    bgClass: "bg-blue-50 dark:bg-blue-950/40",
    borderClass: "border-blue-200 dark:border-blue-900/50",
    swatchBg: "bg-blue-500",
  },
  emerald: {
    label: "Emerald",
    textClass: "text-emerald-600 dark:text-emerald-400",
    bgClass: "bg-emerald-50 dark:bg-emerald-950/40",
    borderClass: "border-emerald-200 dark:border-emerald-900/50",
    swatchBg: "bg-emerald-500",
  },
  amber: {
    label: "Amber",
    textClass: "text-amber-600 dark:text-amber-400",
    bgClass: "bg-amber-50 dark:bg-amber-950/40",
    borderClass: "border-amber-200 dark:border-amber-900/50",
    swatchBg: "bg-amber-500",
  },
  violet: {
    label: "Violet",
    textClass: "text-violet-600 dark:text-violet-400",
    bgClass: "bg-violet-50 dark:bg-violet-950/40",
    borderClass: "border-violet-200 dark:border-violet-900/50",
    swatchBg: "bg-violet-500",
  },
  sky: {
    label: "Sky",
    textClass: "text-sky-600 dark:text-sky-400",
    bgClass: "bg-sky-50 dark:bg-sky-950/40",
    borderClass: "border-sky-200 dark:border-sky-900/50",
    swatchBg: "bg-sky-500",
  },
  orange: {
    label: "Orange",
    textClass: "text-orange-600 dark:text-orange-400",
    bgClass: "bg-orange-50 dark:bg-orange-950/40",
    borderClass: "border-orange-200 dark:border-orange-900/50",
    swatchBg: "bg-orange-500",
  },
  rose: {
    label: "Rose",
    textClass: "text-rose-600 dark:text-rose-400",
    bgClass: "bg-rose-50 dark:bg-rose-950/40",
    borderClass: "border-rose-200 dark:border-rose-900/50",
    swatchBg: "bg-rose-500",
  },
  slate: {
    label: "Slate",
    textClass: "text-slate-600 dark:text-slate-400",
    bgClass: "bg-slate-100 dark:bg-slate-900",
    borderClass: "border-slate-200 dark:border-slate-800",
    swatchBg: "bg-slate-500",
  },
};

export function DomainClassifierManager({ domains, onRefresh, canManage }: Props) {
  const [editingDomain, setEditingDomain] = useState<ClassifierDomainItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form states
  const [domainKey, setDomainKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [jiraProject, setJiraProject] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  // v1.5.4 — per-domain keyword chip expansion
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [selectedIcon, setSelectedIcon] = useState("BookOpen");
  const [selectedColor, setSelectedColor] = useState("blue");
  const [customIcon, setCustomIcon] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCustomIconUpload = (file: File) => {
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setError("Only PNG or JPG images are allowed for custom icon.");
      return;
    }
    if (file.size > 1 * 1024 * 1024) {
      setError("Custom icon size cannot exceed 1 MB.");
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        setCustomIcon(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  const startCreate = () => {
    setIsCreating(true);
    setEditingDomain(null);
    setDomainKey("");
    setDisplayName("");
    setDescription("");
    setJiraProject("");
    setKeywordsText("");
    setSelectedIcon("BookOpen");
    setSelectedColor("blue");
    setCustomIcon(null);
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
    setSelectedIcon(d.icon || "BookOpen");
    setSelectedColor(d.color || "blue");
    setCustomIcon(d.custom_icon || null);
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
          icon: selectedIcon,
          color: selectedColor,
          custom_icon: customIcon || undefined,
          is_active: isActive,
        });
      } else if (editingDomain) {
        // Rename first if the key changed (atomic cascade), then update the rest.
        if (domainKey.trim().toLowerCase() !== editingDomain.domain_key) {
          if (
            !confirm(
              `Rename domain key "${editingDomain.domain_key}" → "${domainKey.trim().toLowerCase()}"?\n\n` +
                "This migrates all KB pages and stored vector metadata in one transaction and cannot be undone."
            )
          ) {
            setLoading(false);
            return;
          }
          await renameClassifierDomain(editingDomain.id, domainKey.trim().toLowerCase());
        }
        await updateClassifierDomain(editingDomain.id, {
          display_name: displayName.trim(),
          description: description.trim() || undefined,
          keywords: kwList,
          jira_project: jiraProject.trim() || undefined,
          icon: selectedIcon,
          color: selectedColor,
          custom_icon: customIcon || "",
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
    if (!confirm(`Are you sure you want to delete domain "${d.display_name}"?`)) return;
    try {
      await deleteClassifierDomain(d.id);
      onRefresh();
    } catch (err: any) {
      alert(err.message || "Failed to delete domain");
    }
  };

  const PreviewIconComp = ICON_OPTIONS[selectedIcon]?.icon || BookOpen;
  const previewColorDef = COLOR_OPTIONS[selectedColor] || COLOR_OPTIONS.blue;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Configured Routing Domains</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time keyword triggers, domain classifier thresholds, custom icons/colors, and Jira escalation project mapping.
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

      {/* Form (Create / Edit) — right-side slide-over */}
      <Dialog open={!!(isCreating || editingDomain)} onOpenChange={(o) => { if (!o) cancelForm(); }}>
        <DialogContent side="right" className="gap-0 p-0">
        <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-[var(--border)] px-6 py-4 pr-12">
            <h5 className="text-sm font-semibold text-slate-900 dark:text-white">
              {isCreating ? "Add New Domain" : `Edit Domain: ${editingDomain?.display_name}`}
            </h5>
            <p className="mt-0.5 text-xs text-muted-foreground">Changes apply immediately to the classification engine & Knowledge Base</p>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {error && (
            <div className="flex items-center gap-2 p-2.5 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/40 rounded-lg border border-rose-200 dark:border-rose-900">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Domain Key (Unique Identifier)
                {!isCreating && domainKey !== (editingDomain?.domain_key || "") && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    <AlertCircle className="size-3" /> Rename — cascades to KB & vectors
                  </span>
                )}
              </label>
              <input
                type="text"
                value={domainKey}
                onChange={(e) => setDomainKey(e.target.value.toLowerCase())}
                placeholder="e.g. help_desk, inventory, hr"
                className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                required
              />
              {!isCreating && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Editing the key renames it across the classifier engine, KB pages, and stored vector metadata in one atomic transaction.
                  Confluence space-bound keys cannot be renamed here.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Help Desk & End-User Support"
                className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                required
              />
            </div>
          </div>

          {/* Icon and Color Picker with Live Preview & Custom Icon Upload */}
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-[var(--border)] bg-background p-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Built-in Icon
                </label>
                <select
                  disabled={!!customIcon}
                  value={selectedIcon}
                  onChange={(e) => setSelectedIcon(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-background text-slate-900 dark:text-white outline-none disabled:opacity-50"
                >
                  {Object.entries(ICON_OPTIONS).map(([key, opt]) => (
                    <option key={key} value={key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Custom Icon Upload (PNG/JPG)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCustomIconUpload(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition"
                  >
                    <Upload className="size-3.5" />
                    {customIcon ? "Change Image" : "Upload Image"}
                  </button>
                  {customIcon && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomIcon(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Optional. Overrides the built-in icon with your custom logo.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Accent Theme Color
              </label>
              <div className="flex flex-wrap gap-2 pt-1">
                {Object.entries(COLOR_OPTIONS).map(([key, opt]) => (
                  <button
                    key={key}
                    type="button"
                    title={opt.label}
                    onClick={() => setSelectedColor(key)}
                    className={`size-6 rounded-full ${opt.swatchBg} transition-transform ${
                      selectedColor === key ? "ring-2 ring-offset-2 ring-indigo-500 scale-110" : "opacity-80 hover:opacity-100"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Knowledge Card Preview
              </label>
              <div className="p-3 rounded-xl border border-[var(--border)] bg-card shadow-xs">
                <div className={`size-8 rounded-lg grid place-items-center mb-2 overflow-hidden ${previewColorDef.bgClass}`}>
                  {customIcon ? (
                    <img src={customIcon} alt="Custom icon preview" className="size-full object-contain p-1" />
                  ) : (
                    <PreviewIconComp className={`size-4 ${previewColorDef.textClass}`} />
                  )}
                </div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {displayName || "Domain Title"}
                </div>
                <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                  {description || "Domain description preview..."}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Jira Project Key (Escalation target project)
              </label>
              <input
                type="text"
                value={jiraProject}
                onChange={(e) => setJiraProject(e.target.value)}
                placeholder="e.g. ITHD (leave blank if unused)"
                className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Target Jira Project code for team escalation when the question cannot be answered from Confluence KB.
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
              className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
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
              className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Any user prompt containing these phrases will score towards this domain.
            </p>
          </div>

          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
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
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              {loading ? "Saving..." : "Save Domain"}
            </button>
          </div>
        </form>
        </DialogContent>
      </Dialog>

      {/* Domain Cards List */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {domains.map((d) => {
          const IconComp = (d.icon && ICON_OPTIONS[d.icon]?.icon) || BookOpen;
          const colorDef = (d.color && COLOR_OPTIONS[d.color]) || COLOR_OPTIONS.blue;
          return (
            <div key={d.id} className="p-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition">
              <div className="space-y-2 min-w-0 flex items-start gap-4">
                <div className={`size-10 rounded-xl grid place-items-center shrink-0 mt-0.5 overflow-hidden ${colorDef.bgClass}`}>
                  {d.custom_icon ? (
                    <img src={d.custom_icon} alt={d.display_name} className="size-full object-contain p-1" />
                  ) : (
                    <IconComp className={`size-5 ${colorDef.textClass}`} />
                  )}
                </div>
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900 dark:text-white">{d.display_name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {d.domain_key}
                    </span>
                    {d.is_active ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                        <XCircle className="w-3 h-3" /> Inactive
                      </span>
                    )}
                    {d.jira_project && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900">
                        Jira: {d.jira_project}
                      </span>
                    )}
                  </div>

                  {d.description && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{d.description}</p>
                  )}

                  {/* Keywords badge preview — v1.5.4 collapsible (first 8, +N more) */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(expanded.has(d.id) ? d.keywords : d.keywords.slice(0, 8)).map((kw, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60"
                      >
                        <Tag className="w-2.5 h-2.5 opacity-40" />
                        {kw}
                      </span>
                    ))}
                    {d.keywords.length > 8 && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(d.id)}
                        className="px-2 py-0.5 rounded-md text-[10px] font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/50 border border-indigo-200/60 dark:border-indigo-900/60"
                      >
                        {expanded.has(d.id) ? "Show less" : `+${d.keywords.length - 8} more`}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {canManage && (
                <div className="flex items-center gap-2 self-end sm:self-start shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(d)}
                    className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg transition"
                    title="Edit domain"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(d)}
                    className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition"
                    title="Delete domain"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
