/**
 * ForceGraph — a small force-directed view of the context graph, rendered as SVG.
 *
 * SVG + d3-force (rather than a canvas chart library) on purpose: the data here is at most a
 * few hundred nodes, and SVG inherits the app's own type scale, colours and dark theme for
 * free instead of needing them re-declared in a canvas renderer.
 *
 * The simulation runs on CLONES. d3-force mutates the node objects it is given, so feeding it
 * React state directly would rewrite props and cause the parent to see data it does not own.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphEdge, GraphNode } from "@/features/semantica/api";

type SimNode = SimulationNodeDatum & {
  id: string;
  label: string | null;
  mentions: number;
  degree: number;
};

type SimLink = { source: string | SimNode; target: string | SimNode; predicate: string; mentions: number };

const LABEL_COLOURS: Record<string, string> = {
  ORGANIZATION: "#6366f1", ORG: "#6366f1", PERSON: "#ec4899",
  LOCATION: "#0ea5e9", GPE: "#0ea5e9", DATE: "#f59e0b", TIME: "#f59e0b",
  PRODUCT: "#10b981", TECHNOLOGY: "#10b981", MISC: "#94a3b8",
  VERSION: "#8b5cf6", NUMBER: "#64748b", QUANTITY: "#64748b",
  IP: "#ef4444", HOSTNAME: "#14b8a6", URL: "#a855f7", EMAIL: "#f97316",
  ENTITY: "#94a3b8",
};

function colourFor(label: string | null | undefined): string {
  if (!label) return LABEL_COLOURS.ENTITY;
  return LABEL_COLOURS[label.toUpperCase()] ?? "#94a3b8";
}

export default function ForceGraph({
  nodes, edges, height = 460, selected, onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  height?: number;
  selected?: string | null;
  onSelect?: (name: string) => void;
}) {
  const W = 900;
  const H = height;
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);

  // Degrees decide which labels are worth drawing — labelling all of them is unreadable.
  const simNodes = useMemo<SimNode[]>(() => {
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.subject, (degree.get(e.subject) ?? 0) + 1);
      degree.set(e.object, (degree.get(e.object) ?? 0) + 1);
    }
    return nodes.map((n) => ({
      id: n.name,
      label: n.label,
      mentions: n.mentions,
      degree: degree.get(n.name) ?? 0,
    }));
  }, [nodes, edges]);

  const simLinks = useMemo<SimLink[]>(
    () => edges.map((e) => ({ source: e.subject, target: e.object, predicate: e.predicate, mentions: e.mentions })),
    [edges],
  );

  useEffect(() => {
    if (!simNodes.length) return;
    const sim = forceSimulation<SimNode>(simNodes)
      .force("charge", forceManyBody<SimNode>().strength(-90))
      .force("center", forceCenter(W / 2, H / 2))
      .force("collide", forceCollide<SimNode>().radius((d) => radius(d) + 4))
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((l) => 70 + (l.mentions > 3 ? 0 : 30))
          .strength(0.35),
      )
      .on("tick", () => setTick((t) => t + 1));

    simRef.current = sim;
    // Settle quickly: a graph that keeps drifting is hard to click.
    sim.alphaDecay(0.045);
    return () => { sim.stop(); simRef.current = null; };
  }, [simNodes, simLinks, H]);

  const nodesById = useMemo(() => {
    const m = new Map<string, SimNode>();
    for (const n of simNodes) m.set(n.id, n);
    return m;
  }, [simNodes]);

  function radius(d: SimNode): number {
    return Math.min(20, 3.5 + Math.sqrt(d.mentions) * 1.6);
  }

  // The names worth labelling: the biggest handful of nodes, plus whatever is selected or
  // hovered so the interaction always names what it is acting on.
  const labelled = useMemo(() => {
    const top = [...simNodes].sort((a, b) => b.mentions - a.mentions).slice(0, 22).map((n) => n.id);
    if (selected) top.push(selected);
    if (hover) top.push(hover);
    return new Set(top);
  }, [simNodes, selected, hover]);

  const focus = hover ?? selected ?? null;
  const neighbours = useMemo(() => {
    if (!focus) return null;
    const s = new Set<string>([focus]);
    for (const e of simLinks) {
      const a = typeof e.source === "string" ? e.source : e.source.id;
      const b = typeof e.target === "string" ? e.target : e.target.id;
      if (a === focus) s.add(b);
      if (b === focus) s.add(a);
    }
    return s;
  }, [focus, simLinks]);

  if (!simNodes.length) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 p-10 text-xs text-slate-500 dark:border-slate-700">
        No graph yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" style={{ maxHeight: H }} role="img"
           aria-label={`Context graph with ${simNodes.length} entities and ${simLinks.length} relationships`}>
        <g data-tick={tick}>
          {simLinks.map((l, i) => {
            const s = typeof l.source === "string" ? nodesById.get(l.source) : l.source;
            const t = typeof l.target === "string" ? nodesById.get(l.target) : l.target;
            if (!s?.x || !t?.x) return null;
            const a = s.id, b = t.id;
            const dim = neighbours ? !(neighbours.has(a) && neighbours.has(b)) : false;
            return (
              <line
                key={`${a}|${l.predicate}|${b}|${i}`}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={dim ? "#e2e8f0" : "#cbd5e1"}
                strokeWidth={dim ? 0.6 : Math.min(2.4, 0.8 + l.mentions * 0.25)}
                opacity={dim ? 0.35 : 0.9}
                className="dark:stroke-slate-600"
              />
            );
          })}

          {simNodes.map((n) => {
            const isFocus = focus === n.id;
            const dim = neighbours ? !neighbours.has(n.id) : false;
            const r = radius(n);
            return (
              <g key={n.id} transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                 opacity={dim ? 0.28 : 1}
                 style={{ cursor: onSelect ? "pointer" : "default" }}
                 onMouseEnter={() => setHover(n.id)}
                 onMouseLeave={() => setHover(null)}
                 onClick={() => onSelect?.(n.id)}>
                <circle r={r} fill={colourFor(n.label)}
                        stroke={isFocus ? "#0f172a" : "white"} strokeWidth={isFocus ? 2.4 : 1.2} />
                {labelled.has(n.id) && (
                  <text x={r + 4} y={4} fontSize={11}
                        className="fill-slate-700 dark:fill-slate-200"
                        style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 }}>
                    {n.id.length > 30 ? n.id.slice(0, 29) + "…" : n.id}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-800">
        <span className="font-medium">Legend</span>
        {Object.entries({ ORGANIZATION: "org", PERSON: "person", LOCATION: "location", DATE: "date",
                          TECHNOLOGY: "technology", VERSION: "version", IP: "ip", HOSTNAME: "host",
                          ENTITY: "other" }).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-full" style={{ background: colourFor(k) }} />
            {v}
          </span>
        ))}
        <span className="ml-auto">node size = mentions · edge width = co-occurrence</span>
      </div>
    </div>
  );
}