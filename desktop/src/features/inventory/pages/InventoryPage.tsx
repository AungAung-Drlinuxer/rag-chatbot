import { useState, useEffect } from "react";
import { PageShell, PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Boxes,
  Plus,
  Search,
  RefreshCw,
  Server,
  Laptop,
  Network,
  Printer,
  Trash2,
  Pencil,
  FileText,
} from "lucide-react";
import {
  listInventory,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  type InventoryItem,
} from "@/features/inventory/api";

type Props = {
  role: string;
  userName: string;
  onToast?: (msg: string, kind?: "ok" | "err") => void;
};

const CATEGORIES = [
  { id: "all", label: "All Assets", icon: Boxes },
  { id: "server", label: "Servers", icon: Server },
  { id: "laptop", label: "Laptops / PCs", icon: Laptop },
  { id: "network", label: "Networking", icon: Network },
  { id: "printer", label: "Printers", icon: Printer },
  { id: "software", label: "Software / Licenses", icon: FileText },
];

export default function InventoryPage({ role, onToast }: Props) {
  const canEdit = role === "admin" || role === "knowledge";
  const isAdmin = role === "admin";

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<InventoryItem | null>(null);
  const [busy, setBusy] = useState(false);

  // Form State
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("server");
  const [formHostname, setFormHostname] = useState("");
  const [formIp, setFormIp] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formAssignedTo, setFormAssignedTo] = useState("");
  const [formSerial, setFormSerial] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const loadData = () => {
    setLoading(true);
    listInventory(search, activeCategory === "all" ? "" : activeCategory)
      .then((res) => setItems(res.items || []))
      .catch((err) => onToast?.(err?.message || "Failed to load inventory", "err"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [activeCategory]);

  const openCreateModal = () => {
    setEditingItem(null);
    setFormName("");
    setFormCategory("server");
    setFormHostname("");
    setFormIp("");
    setFormLocation("");
    setFormAssignedTo("");
    setFormSerial("");
    setFormNotes("");
    setModalOpen(true);
  };

  const openEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormCategory(item.category || "server");
    setFormHostname(item.hostname || "");
    setFormIp(item.ip_address || "");
    setFormLocation(item.location || "");
    setFormAssignedTo(item.assigned_to || "");
    setFormSerial(item.serial || "");
    setFormNotes(item.notes || "");
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      onToast?.("Asset name is required", "err");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: formName.trim(),
        category: formCategory,
        hostname: formHostname.trim() || null,
        ip_address: formIp.trim() || null,
        location: formLocation.trim() || null,
        assigned_to: formAssignedTo.trim() || null,
        serial: formSerial.trim() || null,
        notes: formNotes.trim() || null,
      };

      if (editingItem) {
        await updateInventoryItem(editingItem.id, payload);
        onToast?.(`Asset "${formName}" updated successfully`, "ok");
      } else {
        await createInventoryItem(payload);
        onToast?.(`Asset "${formName}" added to inventory`, "ok");
      }
      setModalOpen(false);
      loadData();
    } catch (e: any) {
      onToast?.(e.message || "Failed to save asset", "err");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (item: InventoryItem) => {
    setBusy(true);
    try {
      await deleteInventoryItem(item.id);
      onToast?.(`Asset "${item.name}" deleted`, "ok");
      setConfirmDelete(null);
      loadData();
    } catch (e: any) {
      onToast?.(e.message || "Failed to delete asset", "err");
    } finally {
      setBusy(false);
    }
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat.toLowerCase()) {
      case "server":
        return <Server className="size-4 text-blue-500" />;
      case "laptop":
        return <Laptop className="size-4 text-emerald-500" />;
      case "network":
        return <Network className="size-4 text-purple-500" />;
      case "printer":
        return <Printer className="size-4 text-amber-500" />;
      default:
        return <Boxes className="size-4 text-slate-500" />;
    }
  };

  return (
    <PageShell>
      <PageHeader
        icon={<Boxes className="size-5" />}
        badge={isAdmin ? "Administrator" : canEdit ? "Knowledge Manager" : "User"}
        title="IT Inventory & Assets"
        description="Centralized hardware, server, and license catalog for IT help desk and natural language queries."
        actions={
          <>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={loadData}>
              <RefreshCw className={`mr-2 size-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {canEdit && (
              <Button
                size="sm"
                className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-xs"
                onClick={openCreateModal}
              >
                <Plus className="mr-1.5 size-4" />
                Add Asset
              </Button>
            )}
          </>
        }
      />

      <div className="mx-auto max-w-[1200px] space-y-5 p-5 lg:p-8">
        {/* Filters and Search Bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition",
                    activeCategory === cat.id
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800",
                  ].join(" ")}
                >
                  <Icon className="size-3.5" />
                  {cat.label}
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadData()}
              placeholder="Search assets, IP, user..."
              className="w-full rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-blue-500 dark:border-slate-800 dark:bg-slate-900"
            />
          </div>
        </div>

        {/* Assets Table */}
        <Card className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between border-b px-5 py-4 dark:border-slate-800">
            <h2 className="text-sm font-semibold">Asset Inventory Records</h2>
            <span className="text-[10px] text-muted-foreground">
              {items.length} item{items.length === 1 ? "" : "s"} found
            </span>
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-12 text-center text-xs text-muted-foreground">
              No inventory assets found matching your criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase text-muted-foreground dark:bg-slate-900/60 border-b dark:border-slate-800">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Asset / Name</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Hostname</th>
                    <th className="px-4 py-3 font-semibold">IP Address</th>
                    <th className="px-4 py-3 font-semibold">Location</th>
                    <th className="px-4 py-3 font-semibold">Assigned To</th>
                    {canEdit && <th className="px-4 py-3 text-right font-semibold">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-800">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-slate-100 dark:bg-slate-800">
                            {getCategoryIcon(item.category)}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {item.name}
                            </span>
                            {item.serial && (
                              <div className="text-[10px] font-mono text-muted-foreground">
                                S/N: {item.serial}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 capitalize">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {item.category}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        {item.hostname || "—"}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-blue-600 dark:text-blue-400">
                        {item.ip_address || "—"}
                      </td>
                      <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400">
                        {item.location || "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        {item.assigned_to ? (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            {item.assigned_to}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEditModal(item)}
                              title="Edit item"
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => setConfirmDelete(item)}
                                title="Delete item"
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Modal: Create or Edit Item */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-xs">
          <Card className="w-full max-w-lg rounded-2xl p-6 shadow-2xl">
            <h3 className="text-sm font-semibold">
              {editingItem ? `Edit Asset: ${editingItem.name}` : "Add New IT Asset"}
            </h3>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[10px] font-medium text-muted-foreground">Asset Name *</label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. core-router-01, dev-laptop-24"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="text-[10px] font-medium text-muted-foreground">Category *</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="server">Server</option>
                  <option value="laptop">Laptop / PC</option>
                  <option value="network">Network Device</option>
                  <option value="printer">Printer</option>
                  <option value="software">Software / License</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-medium text-muted-foreground">Hostname</label>
                <input
                  value={formHostname}
                  onChange={(e) => setFormHostname(e.target.value)}
                  placeholder="e.g. srv-prod-01.internal"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="text-[10px] font-medium text-muted-foreground">IP Address</label>
                <input
                  value={formIp}
                  onChange={(e) => setFormIp(e.target.value)}
                  placeholder="e.g. 10.10.10.45"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="text-[10px] font-medium text-muted-foreground">Location</label>
                <input
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="e.g. DataCenter Rack 4, HQ 2F"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="text-[10px] font-medium text-muted-foreground">Assigned To (User/Team)</label>
                <input
                  value={formAssignedTo}
                  onChange={(e) => setFormAssignedTo(e.target.value)}
                  placeholder="e.g. aungaung, sysadmin-team"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div className="col-span-2">
                <label className="text-[10px] font-medium text-muted-foreground">Serial / Asset Tag</label>
                <input
                  value={formSerial}
                  onChange={(e) => setFormSerial(e.target.value)}
                  placeholder="e.g. DELL-SN-982134"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div className="col-span-2">
                <label className="text-[10px] font-medium text-muted-foreground">Notes / Specifications</label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={2}
                  placeholder="Operating system, specs, warranty info..."
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={handleSave}
                className="rounded-xl bg-blue-600 text-white hover:bg-blue-700"
              >
                {busy ? "Saving…" : "Save Asset"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <Card className="w-full max-w-sm rounded-2xl p-6 shadow-2xl">
            <h3 className="text-sm font-semibold text-rose-600">Delete Asset Record</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              Are you sure you want to remove <strong>{confirmDelete.name}</strong> from the IT inventory?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => handleDelete(confirmDelete)}
                className="rounded-xl bg-rose-600 text-white hover:bg-rose-700"
              >
                {busy ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
