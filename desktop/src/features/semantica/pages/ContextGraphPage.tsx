/**
 * Context Graph — the Semantica spike, viewed from the app (admin only).
 *
 * WHAT THIS PAGE IS
 * A read-only window onto a knowledge graph built by a separate `semantica-spike` service
 * from this estate's own knowledge base. It exists to answer one question with real data:
 * does a structured context graph add anything over the vector index the app already has?
 *
 * WHAT IT IS NOT
 * Not wired into chat, retrieval or tickets. Nothing in the answer path reads these tables.
 * The service and its two tables can be removed without touching anything else — this page
 * and backend/app/api/semantica_spike.py are the entire surface area.
 *
 * The graph is built WITHOUT an LLM (pattern/ML extraction only), so what you see is
 * reproducible: the same 229 articles produce the same graph.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, GitBranch, Link2, RefreshCw, Search, Share2, Sparkles, TriangleAlert } from "lucide-react";
import { PageShell, PageHeader, SectionCard, btnSecondary } from "@/components/ui/page";
import ForceGraph from "@/features/semantica/components/ForceGraph";
import {
  getGraph, getProvenance, getRelations, getStats,
  type EntityRow, type GraphEdge, type GraphNode, type Stats,
} from "@/features/semantica/api";

export default function ContextGraphPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [prov, setProv] = useState<EntityRow[]>([]);
  const [rels, setRels] = useState<GraphEdge[]>([]);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const [s, g] = await Promise.all([getStats(), getGraph(150)]);
      setStats(s);
      setGraph(g);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStats(null);
      setGraph(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Selecting a node loads its two most interesting facets: where the fact came from, and
  // what it is connected to.
  useEffect(() => {
    if (!selected) { setProv([]); setRels([]); return; }
    let live = true;
    (async () => {
      try {
        const [p, r] = await Promise.all([getProvenance(selected), getRelations(selected)]);
        if (live) { setProv(p); setRels(r); }
      } catch { if (live) { setProv([]); setRels([]); } }
    })();
    return () => { live = false; };
  }, [selected]);

  const shownNodes = useMemo(() => {
    if (!graph) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return graph.nodes;
    return graph.nodes.filter((n) => n.name.toLowerCase().includes(q));
  }, [graph, filter]);

  const shownEdges = useMemo(() => {
    if (!graph) return [];
    const keep = new Set(shownNodes.map((n) => n.name));
    return graph.edges.filter((e) => keep.has(e.subject) && keep.has(e.object));
  }, [graph, shownNodes]);

  const cards = stats
    ? [
        { label: "Entities", value: stats.entities, hint: "distinct, de-duplicated names" },
        { label: "Relationships", value: stats.relations, hint: "subject → predicate → object" },
        { label: "Entity types", value: stats.by_label.length, hint: "labels extraction produced" },
        { label: "Sources", value: 229, hint: "kb_meta articles ingested" },
      ]
    : [];

  return (
    <PageShell>
      <PageHeader
        title="Context Graph"
        badge="SPIKE"
        icon={<Share2 className="size-5" />}
        description="A knowledge graph built from this knowledge base by Semantica — evaluation only, not wired into chat or retrieval."
        actions={
          <button type="button" onClick={() => void load()} disabled={busy}
                  className={`${btnSecondary} disabled:opacity-50`}>
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Loading…" : "Reload"}
          </button>
        }
      />

      {/* The honest framing, up front — a spike that looks like a shipped feature invites the
          wrong conclusion about what is actually wired in. */}
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-semibold">Evaluation surface — nothing depends on it.</p>
          <p className="mt-0.5 opacity-90">
            Built by a separate <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">semantica-spike</code> service
            from the same <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">kb_meta</code> rows the app reads.
            Extraction is deterministic (no LLM), so the graph is reproducible. Chat, retrieval and tickets are untouched;
            the two tables it writes can be dropped at any time.
          </p>
        </div>
      </div>

      {err && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50/70 px-4 py-3 text-[11px] text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          <p className="font-semibold">The spike service is not answering.</p>
          <p className="mt-0.5 opacity-90">{err}</p>
          <p className="mt-1 opacity-80">
            If the pod was just started it is likely still building the graph from 229 articles — reload in a minute.
          </p>
        </div>
      )}

      {stats && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border border-[var(--border)] bg-card px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{c.value.toLocaleString()}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{c.hint}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[2fr_1fr]">
        <div className="min-w-0">
        <SectionCard
          title="Graph"
          icon={<Share2 className="size-4" />}
          description={
            graph
              ? `${shownNodes.length} node(s) · ${shownEdges.length} edge(s)${graph.truncated ? " · bounded to the most-mentioned entities" : ""}`
              : "loading"
          }
        >
          <div className="p-4">
            {/* The filter lives here, not in the card's `actions` slot: that slot sits in a
                `shrink-0` flex row that cannot wrap, so a fixed-width input widened the whole
                card to 442px inside a 390px viewport. In the body it can be full width. */}
            <div className="relative mb-3 sm:max-w-56">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter entities…"
                aria-label="Filter entities"
                className="h-8 w-full rounded-lg border border-[var(--border)] bg-background pl-7 pr-2 text-[11px] outline-none focus:ring-1 focus:ring-sky-400"
              />
            </div>
            <ForceGraph
              nodes={shownNodes}
              edges={shownEdges}
              selected={selected}
              onSelect={(n) => setSelected((cur) => (cur === n ? null : n))}
            />
            <p className="mt-2 text-[10px] text-muted-foreground">
              Click a node to see where the fact came from and what it connects to. Node colour is the extracted entity
              type; size is how often it appears across the knowledge base.
            </p>
          </div>
        </SectionCard>
        </div>

        <div className="min-w-0 space-y-5">
          <SectionCard
            title="Entity"
            icon={<Boxes className="size-4" />}
            description={selected ? "provenance and connections" : "select a node in the graph"}
          >
            {!selected && (
              <p className="px-4 py-6 text-[11px] text-muted-foreground">
                Nothing selected. Click any node — this panel is the part worth evaluating: it answers
                “which documents produced this fact”.
              </p>
            )}
            {selected && (
              <div className="min-w-0 space-y-4 p-4">
                <div>
                  <p className="break-all text-sm font-semibold">{selected}</p>
                  {prov[0]?.label && (
                    <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {prov[0].label}
                    </span>
                  )}
                  {prov[0] && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {prov[0].mentions} mention(s) across {prov[0].page_ids?.length ?? 0} article(s)
                    </p>
                  )}
                </div>

                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <GitBranch className="size-3" /> Provenance
                  </p>
                  {(prov[0]?.source_urls?.length ?? 0) === 0 && (
                    <p className="text-[11px] text-muted-foreground">No source URL recorded for this entity.</p>
                  )}
                  <ul className="max-h-40 min-w-0 space-y-1 overflow-auto">
                    {prov[0]?.source_urls?.map((u) => (
                      <li key={u} className="truncate text-[11px]">
                        <a href={u} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline dark:text-sky-400">
                          {u}
                        </a>
                      </li>
                    ))}
                  </ul>
                  {(prov[0]?.page_ids?.length ?? 0) > 0 && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      KB page ids: {prov[0].page_ids.slice(0, 10).join(", ")}
                      {prov[0].page_ids.length > 10 ? "…" : ""}
                    </p>
                  )}
                </div>

                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Link2 className="size-3" /> Connections ({rels.length})
                  </p>
                  <ul className="max-h-56 min-w-0 space-y-1 overflow-auto">
                    {rels.slice(0, 40).map((r, i) => (
                      <li key={i} className="text-[11px] leading-snug">
                        <span className="text-muted-foreground">{r.subject}</span>
                        <span className="mx-1 rounded bg-slate-100 px-1 font-mono text-[10px] dark:bg-slate-800">
                          {r.predicate}
                        </span>
                        <span className="text-muted-foreground">{r.object}</span>
                      </li>
                    ))}
                    {!rels.length && <li className="text-[11px] text-muted-foreground">No edges recorded.</li>}
                  </ul>
                </div>
              </div>
            )}
          </SectionCard>

          {stats && (
            <SectionCard title="Entity types" icon={<Sparkles className="size-4" />} description="what extraction found">
              <div className="flex flex-wrap gap-1.5 p-4">
                {stats.by_label.map((b) => (
                  <span key={b.label ?? "null"}
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {b.label ?? "unlabelled"} <span className="tabular-nums opacity-60">{b.c}</span>
                  </span>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {stats && (
        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
          <div className="min-w-0">
          <SectionCard title="Most-mentioned entities" icon={<Boxes className="size-4" />} description="click to inspect">
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-4 py-2 font-medium">Entity</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 text-right font-medium">Mentions</th></tr>
                </thead>
                <tbody>
                  {stats.top_entities.map((e) => (
                    <tr key={`${e.name}|${e.label}`}
                        onClick={() => setSelected(e.name)}
                        className="cursor-pointer border-t border-[var(--border)] hover:bg-muted/40">
                      <td className="px-4 py-1.5 font-medium">{e.name}</td>
                      <td className="px-4 py-1.5 text-muted-foreground">{e.label ?? "—"}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{e.mentions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
          </div>

          <div className="min-w-0">
          <SectionCard title="Strongest relationships" icon={<GitBranch className="size-4" />} description="highest co-occurrence">
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Subject</th>
                    <th className="px-4 py-2 font-medium">Predicate</th>
                    <th className="px-4 py-2 font-medium">Object</th>
                    <th className="px-4 py-2 text-right font-medium">×</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.top_relations.map((r, i) => (
                    <tr key={i} className="border-t border-[var(--border)]">
                      <td className="max-w-[8rem] truncate px-4 py-1.5 sm:max-w-[12rem]">{r.subject}</td>
                      <td className="px-4 py-1.5">
                        <span className="rounded bg-slate-100 px-1 font-mono text-[10px] dark:bg-slate-800">{r.predicate}</span>
                      </td>
                      <td className="max-w-[8rem] truncate px-4 py-1.5 sm:max-w-[12rem]">{r.object}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{r.mentions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
          </div>
        </div>
      )}
    </PageShell>
  );
}