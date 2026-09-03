/** Knowledge feature API — article search/CRUD + Confluence sync (mirrors /api/articles*). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export async function searchArticles(query: string, domain?: string, top_k = 5) {
  const r = await apiFetch(`${BASE}/api/articles/search`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ query, domain, top_k }),
  });
  return r.json();
}

export async function createArticle(body: any) {
  const r = await apiFetch(`${BASE}/api/articles`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}

export async function updateArticle(page_id: string, body: any) {
  const r = await apiFetch(`${BASE}/api/articles/${page_id}`, { method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ ...body, page_id }) });
  return { status: r.status, data: await r.json() };
}

export async function deleteArticle(page_id: string) {
  const r = await apiFetch(`${BASE}/api/articles/${page_id}`, { method: "DELETE", headers: authHeaders() });
  return { status: r.status, data: await r.json() };
}

export async function triggerSync() {
  const r = await apiFetch(`${BASE}/api/articles/sync`, { method: "POST", headers: authHeaders() });
  return { status: r.status, data: await r.json() };
}

export async function articleDraft(topic: string, domain: string) {
  const r = await apiFetch(`${BASE}/api/articles/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ topic, domain }),
  });
  return r.json();
}

// --- KB browse/list (Knowledge page) ---
export async function listArticleDomains() {
  const r = await apiFetch(`${BASE}/api/articles-domains`, { headers: authHeaders() });
  return r.json(); // { domains }
}

export async function listRecentArticles(limit = 8) {
  const r = await apiFetch(`${BASE}/api/articles-recent?limit=${limit}`, { headers: authHeaders() });
  return r.json(); // { articles }
}

export async function getSyncStatus() {
  const r = await apiFetch(`${BASE}/api/sync-status`, { headers: authHeaders() });
  return r.json();
}

export async function listArticles(queryString: string) {
  const r = await apiFetch(`${BASE}/api/articles-list?${queryString}`, { headers: authHeaders() });
  return r.json(); // { articles }
}
