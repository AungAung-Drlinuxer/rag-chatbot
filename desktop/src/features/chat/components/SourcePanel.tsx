/**
 * SourcePanel — the right-hand "Knowledge sources" surface of the chat page.
 *
 * WHY IT IS ITS OWN FILE
 * It was 90 lines inline in ChatPage.tsx (1370 lines), which made the one surface
 * that is pure presentation the hardest thing on the page to render in isolation.
 * Extracted for the same reason MessageParts was: `scripts/sources_harness_shot.mjs`
 * can render and MEASURE the real component without signing in as anyone.
 *
 * LAYOUT CONTRACT (top to bottom)
 *   header    title + source count           fixed 44px — the message column never shifts
 *   meta      one line of real numbers       + a collapsed "Retrieval details" block
 *   filter    only at >= 4 sources           a filter over nothing is noise
 *   list      rank-ordered cards             same page collapsed into one card with xN
 *
 * HONESTY RULES CARRIED OVER FROM THE OLD PANEL
 *   - Every figure comes from the SSE `meta.retrieval` payload. When the backend did
 *     not report one it reads "—"; nothing is substituted.
 *   - `chunks` and `cited` are built server-side from the SAME list (`sources` is one
 *     entry per retrieved doc), so they are always equal. Showing them as two rows
 *     claimed a difference that does not exist: they collapse to one figure when equal
 *     and both appear when they genuinely differ.
 *   - A live-infrastructure answer has no retrieval numbers at all, so the panel says
 *     so instead of rendering a row of dashes as if it were data.
 */
import { useMemo, useState } from "react";

import SystemStatus from "@/features/chat/components/SystemStatusPanel";
import { ChevronDown, Link2, Search } from "lucide-react";

import { EmptyState } from "@/components/ui/page";
import { SourceCard } from "@/features/chat/components/MessageParts";
import { type RetrievalInfo, type Source } from "@/features/chat/model";

/** Sources this many times or fewer are not worth a filter control. */
const FILTER_FROM = 4;

type Group = { key: string; source: Source; chunks: number };

/**
 * Collapse repeated retrievals of the same article into one entry.
 *
 * The retriever deliberately returns up to 2 chunks per article (`_cap_per_article`)
 * and then expands each winner with its neighbours, so the same page_id legitimately
 * appears more than once. Listing it twice showed the reader the same article as two
 * separate sources. The FIRST occurrence is kept, which preserves rank order.
 */
function groupSources(sources: Source[]): Group[] {
  const order: Group[] = [];
  const byKey = new Map<string, Group>();
  for (const s of sources) {
    // page_id is the real identity; a ticket row has none, so its title is the key.
    const key = s.page_id ?? `title:${s.title}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.chunks += 1;
      continue;
    }
    const g: Group = { key, source: s, chunks: 1 };
    byKey.set(key, g);
    order.push(g);
  }
  return order;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

export default function SourcePanel({
  sources,
  retrieval,
  live = false,
  onExplain,
  onAsk,
  onNavigate,
}: {
  sources: Source[];
  retrieval: RetrievalInfo | null;
  /** True when the newest answer came from live tooling, which has no retrieval stats. */
  live?: boolean;
  onExplain?: (source: Source) => void;
  /** Empty-state CTA — puts the caret back in the composer. */
  onAsk?: () => void;
  /** Quick Actions need to reach the Tickets page. */
  onNavigate?: (nav: string) => void;
}) {
  const [q, setQ] = useState("");
  const [details, setDetails] = useState(false);

  const groups = useMemo(() => groupSources(sources), [sources]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((g) =>
      `${g.source.title} ${g.source.space} ${g.source.excerpt}`.toLowerCase().includes(needle),
    );
  }, [groups, q]);

  const chunks = retrieval?.chunks ?? null;
  const cited = retrieval?.cited ?? null;
  const sameCounts = chunks != null && cited != null && chunks === cited;
  const shown = chunks ?? cited;
  const searchType =
    retrieval?.rerank_used === true
      ? "Hybrid + rerank"
      : retrieval?.rerank_used === false
        ? "Hybrid (rerank skipped)"
        : null;

  return (
    <aside className="hidden w-84 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--card)] xl:flex">
      {/* ---------------- header (fixed height) ---------------- */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-4">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold leading-tight">Knowledge sources</h2>
          <p className="text-[10px] leading-tight text-muted-foreground">
            Retrieved for this answer
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {sources.length > 0 && (
            <span
              className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground"
              title={`${sources.length} sources retrieved`}
            >
              {sources.length}
            </span>
          )}
          <Link2 className="size-3.5 text-muted-foreground" />
        </div>
      </div>

      {/* ---------------- meta: the numbers, one line ---------------- */}
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-2.5">
        {live ? (
          // A live-infrastructure answer retrieves no documents, so a retrieval strip
          // would be a row of dashes pretending to be telemetry.
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            This answer came from live infrastructure tooling. Its evidence — which
            connector ran, how long it took and what came back — is on the answer itself.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {shown ?? "—"}
              </span>
              <span>{shown === 1 ? "source" : "sources"}</span>
              {!sameCounts && cited != null && (
                <>
                  <span aria-hidden>·</span>
                  <span>cited {cited}</span>
                </>
              )}
              <span aria-hidden>·</span>
              <span className="tabular-nums">Top K {retrieval?.top_k ?? "—"}</span>
              {searchType && (
                <>
                  <span aria-hidden>·</span>
                  <span>{searchType}</span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setDetails((v) => !v)}
              aria-expanded={details}
              className="mt-1.5 inline-flex items-center gap-1 rounded-sm text-[10px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              Retrieval details
              <ChevronDown
                className={["size-3 transition-transform duration-150", details ? "rotate-180" : ""].join(" ")}
              />
            </button>
            {details && (
              <dl className="mt-2 space-y-1.5 border-t border-[var(--border)] pt-2 text-[10px]">
                <DetailRow label="Chunks retrieved" value={chunks != null ? String(chunks) : "—"} />
                <DetailRow label="Sources cited" value={cited != null ? String(cited) : "—"} />
                <DetailRow label="Search type" value={searchType ?? "—"} />
                <DetailRow
                  label="ACL filtering"
                  value={
                    retrieval?.acl_scoped == null
                      ? "—"
                      : retrieval.acl_scoped
                        ? "Enforced (domain-scoped)"
                        : "Enforced (unrestricted role)"
                  }
                />
                <DetailRow label="Top K" value={retrieval?.top_k != null ? String(retrieval.top_k) : "—"} />
                {retrieval?.role && <DetailRow label="Role" value={retrieval.role} />}
              </dl>
            )}
          </>
        )}
      </div>

      {/* ---------------- filter (only when there is something to filter) ---------------- */}
      {groups.length >= FILTER_FROM && (
        <div className="shrink-0 border-b border-[var(--border)] px-4 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter sources"
              aria-label="Filter sources by title, provider or excerpt"
              className="h-7 w-full rounded-lg border border-[var(--border)] bg-background pl-6.5 pr-2 text-[11px] text-foreground outline-none transition focus:border-[var(--primary)]"
            />
          </div>
        </div>
      )}

      {/* ---------------- list ---------------- */}
      <div className="flex-1 overflow-y-auto p-4">
        {sources.length === 0 ? (
          <EmptyState
            icon={<Link2 className="size-5" />}
            title="No sources yet"
            description="Ask a question — the knowledge base articles used to ground the answer appear here, ranked by relevance."
            actionLabel="Ask a question"
            onAction={onAsk}
          />
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-[11px] text-muted-foreground">
              No source matches “{q}”.
            </p>
            <button
              type="button"
              onClick={() => setQ("")}
              className="mt-2 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] font-medium text-foreground transition duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              Clear filter
            </button>
          </div>
        ) : (
          filtered.map((g, i) => (
            <SourceCard
              key={g.key}
              source={g.source}
              index={i + 1}
              chunks={g.chunks}
              onExplain={onExplain}
            />
          ))
        )}
      </div>

      {/* v1.0.1 — the mockup\'s two closing blocks. Outside the scrollable source
          list so they stay reachable however many sources were retrieved. */}
      <SystemStatus onNavigate={onNavigate} />
    </aside>
  );
}
