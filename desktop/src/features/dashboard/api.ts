/** Dashboard feature API (mirrors /api/dashboard*). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export async function dashStats() {
  const r = await apiFetch(`${BASE}/api/dashboard/stats`, { headers: authHeaders() });
  return r.json();
}

export async function dashConversations(days = 7) {
  const r = await apiFetch(`${BASE}/api/dashboard/conversations?days=${days}`, { headers: authHeaders() });
  return r.json();
}

export async function dashDomains() {
  const r = await apiFetch(`${BASE}/api/dashboard/domains`, { headers: authHeaders() });
  return r.json();
}

export async function dashRecentConversations(limit = 10) {
  const r = await apiFetch(`${BASE}/api/dashboard/recent-conversations?limit=${limit}`, { headers: authHeaders() });
  return r.json();
}

export async function dashRecentTickets(limit = 5) {
  const r = await apiFetch(`${BASE}/api/dashboard/recent-tickets?limit=${limit}`, { headers: authHeaders() });
  return r.json();
}

export async function dashHealth() {
  const r = await apiFetch(`${BASE}/api/dashboard/health`, { headers: authHeaders() });
  return r.json();
}
