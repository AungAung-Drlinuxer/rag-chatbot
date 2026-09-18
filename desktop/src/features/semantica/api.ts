/**
 * Semantica spike API — admin-only, read-only.
 *
 * The browser never talks to the semantica-spike service directly: these calls go through
 * `/api/semantica/*` on the backend, which holds the session check and the ClusterIP route.
 * When the spike is removed, this file and one page go with it.
 */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export type GraphNode = { name: string; label: string | null; mentions: number };
export type GraphEdge = { subject: string; predicate: string; object: string; mentions: number };
export type EntityRow = { name: string; label: string | null; mentions: number; page_ids: string[]; source_urls: string[] };

/** One extractor's totals — the comparison the page exists to show. */
export type MethodTotal = { method: string; entities: number; relations: number };

export type Stats = {
  entities: number;
  relations: number;
  /** The extractor these numbers came from. */
  method?: string;
  /** Every extractor present in the tables, for the method switch. */
  methods?: MethodTotal[];
  by_label: { label: string | null; c: number }[];
  top_entities: { name: string; label: string | null; mentions: number }[];
  top_relations: { subject: string; predicate: string; object: string; mentions: number }[];
};

/** Turns a non-2xx into a message the page can show verbatim. */
async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null).map(([k, v]) => [k, String(v)]),
  );
  const url = `${BASE}${path}${qs.toString() ? `?${qs}` : ""}`;
  const r = await apiFetch(url, { headers: authHeaders() });
  if (!r.ok) {
    // The backend answers 503 with a sentence when the pod is down or still building —
    // that is the single most likely failure here, so surface it rather than "HTTP 503".
    let detail = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j?.detail) detail = String(j.detail);
    } catch { /* keep the status code */ }
    throw new Error(detail);
  }
  return r.json() as Promise<T>;
}

export function getStats(method = "") {
  return get<Stats>("/api/semantica/stats", { method });
}

export function getGraph(limit = 120, method = "") {
  return get<{ nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean }>("/api/semantica/graph", { limit, method });
}

export function listEntities(limit = 200, q = "", method = "") {
  return get<EntityRow[]>("/api/semantica/entities", { limit, q, method });
}

export function getProvenance(name: string, method = "") {
  return get<EntityRow[]>("/api/semantica/provenance", { name, method });
}

export function getRelations(subject: string, method = "") {
  return get<GraphEdge[]>("/api/semantica/relation", { subject, method });
}