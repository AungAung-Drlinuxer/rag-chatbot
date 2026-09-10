import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export type InventoryItem = {
  id: number;
  name: string;
  category: string;
  hostname: string | null;
  ip_address: string | null;
  location: string | null;
  assigned_to: string | null;
  serial: string | null;
  notes: string | null;
  updated_at: string | null;
};

export async function listInventory(q = "", category = ""): Promise<{ items: InventoryItem[] }> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  const r = await apiFetch(`${BASE}/api/inventory?${params.toString()}`, { headers: authHeaders() });
  if (!r.ok) throw new Error("Failed to load inventory");
  return r.json();
}

export async function createInventoryItem(data: Partial<InventoryItem>): Promise<InventoryItem> {
  const r = await apiFetch(`${BASE}/api/inventory`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create inventory item");
  }
  return r.json();
}

export async function updateInventoryItem(id: number, data: Partial<InventoryItem>): Promise<InventoryItem> {
  const r = await apiFetch(`${BASE}/api/inventory/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update inventory item");
  }
  return r.json();
}

export async function deleteInventoryItem(id: number): Promise<{ status: string }> {
  const r = await apiFetch(`${BASE}/api/inventory/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to delete inventory item");
  }
  return r.json();
}
