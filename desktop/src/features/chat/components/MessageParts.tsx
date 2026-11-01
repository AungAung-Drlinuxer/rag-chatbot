/**
 * MessageParts — small presentational pieces of a chat message, extracted from
 * ChatPage.tsx (v1.6.68) so the page file stops carrying them.
 */
import { useState } from "react";
import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";

import { type Source } from "@/features/chat/model";

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const high = confidence >= 85;
  const medium = confidence >= 70 && confidence < 85;
  return (
    <span
      className={[
        "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium",
        high
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
          : medium
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-red-200 bg-red-50 text-red-700",
      ].join(" ")}
    >
      <span
        className={[
          "size-1.5 rounded-full",
          high ? "bg-emerald-500" : medium ? "bg-amber-500" : "bg-red-500",
        ].join(" ")}
      />
      {confidence}% confidence
    </span>
  );
}

/* ============================================================================
   SourceCard — one retrieved KB article in the right-hand panel.

   WHAT CHANGED AND WHY (this is the layout, not decoration)
   The previous card put a rank chip and a title on top, then "Relevance" as a
   label/value pair, then a bar, then a 3-line excerpt, then a FULL-WIDTH
   "Explain this source in detail" button. Every card therefore had the same
   visual weight and the same height, and at 8 sources the panel was 8 stacked
   blocks of identical grey text — the rank, which is the one thing that tells
   you where to look first, was the smallest element on the card.

   Now: the score is on the rank line (right-aligned, tabular, colour-tiered),
   the title gets two lines at body size, the excerpt is clamped with a real
   More/Less toggle, and the actions are a compact row. Reading order is
   score -> title -> why it matched -> what you can do with it.

   The relevance bar renders ONLY when a score exists. A ticket lookup has no
   relevance score, and `width: ${null}%` is an invalid declaration — the old
   card still drew a bar for it, at whatever width the browser fell back to.
   ========================================================================= */

/** The same 85/70 thresholds ConfidenceBadge uses, so the panel and the answer's
 *  badge can never disagree about what a good score looks like. */
type Tier = "high" | "medium" | "low" | "none";

function tierOf(relevance: number | null): Tier {
  if (relevance == null) return "none";
  if (relevance >= 85) return "high";
  if (relevance >= 70) return "medium";
  return "low";
}

const TIER_TEXT: Record<Tier, string> = {
  high: "text-emerald-600 dark:text-emerald-400",
  medium: "text-amber-600 dark:text-amber-400",
  low: "text-red-600 dark:text-red-400",
  none: "text-muted-foreground",
};

const TIER_BAR: Record<Tier, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-red-500",
  none: "bg-muted-foreground/30",
};

/** Icon-only action. Every one carries `title` AND `aria-label`: the UI standard's
 *  a11y rule, and the only way an icon-only control is usable without sight. */
const ICON_BTN =
  "grid size-6 place-items-center rounded-md text-muted-foreground transition duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/** Excerpts longer than this get a More/Less toggle instead of being silently cut. */
const EXCERPT_CLAMP = 96;

export function SourceCard({
  source,
  index,
  chunks = 1,
  onExplain,
}: {
  source: Source;
  index: number;
  /** Chunks this article contributed to the answer — the list can repeat a page. */
  chunks?: number;
  /** Ask the assistant to expand this specific source in full detail. */
  onExplain?: (source: Source) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const tier = tierOf(source.relevance);
  // The top three are the ones a reader actually opens; below that the rank is
  // reference information and must not compete for attention.
  const top = index <= 3;
  const long = source.excerpt.length > EXCERPT_CLAMP;
  // `space` carries the classifier domain or the KB provider verbatim; the only
  // transformation is cosmetic, so nothing is invented when it is missing.
  const provider = (source.space || "KB").replace(/[_-]+/g, " ");

  async function copyLink() {
    if (!source.url) return;
    try {
      await navigator.clipboard.writeText(source.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable (insecure origin or denied) — the link is still on screen */
    }
  }

  return (
    <article className="group mb-2.5 rounded-xl bg-card p-3 shadow-xs ring-1 ring-[var(--border)] transition duration-150 hover:-translate-y-px hover:shadow-sm">
      {/* --- line 1: provider + rank ("KB - 1") · chunks · score ------------- */}
      <div className="flex items-center gap-1.5">
        {/* The mockup's chip is the source collection AND its rank in one label —
            "KB - 1" — so the eye reads which article this is before the title. */}
        <span
          className={[
            "shrink-0 rounded-md px-1.5 py-0.5 text-2xs font-semibold capitalize tabular-nums",
            top ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          ].join(" ")}
          title={`Rank ${index} of this answer's sources`}
        >
          {provider} - {index}
        </span>
        {chunks > 1 && (
          <span
            className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-2xs tabular-nums text-muted-foreground"
            title={`${chunks} chunks of this article were retrieved`}
          >
            ×{chunks}
          </span>
        )}
        <span
          className={[
            "ml-auto shrink-0 text-xs font-semibold tabular-nums",
            TIER_TEXT[tier],
          ].join(" ")}
          title={
            source.relevance == null
              ? "This answer came from a live ticket lookup — it has no retrieval score"
              : `Retrieval relevance ${source.relevance}%`
          }
        >
          {source.relevance == null ? "Ticket" : `${source.relevance}%`}
        </span>
      </div>

      {/* --- line 2: title (2 lines at body size) ------------------------------ */}
      <h4 className="mt-2 line-clamp-2 text-xs font-semibold leading-snug" title={source.title}>
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="transition-colors duration-150 hover:text-primary hover:underline"
          >
            {source.title}
          </a>
        ) : (
          source.title
        )}
      </h4>

      {/* --- line 3: score meter (only when a score exists) -------------------- */}
      {source.relevance != null && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={["h-full rounded-full transition-[width] duration-300", TIER_BAR[tier]].join(" ")}
            style={{ width: `${Math.max(0, Math.min(100, source.relevance))}%` }}
          />
        </div>
      )}

      {/* --- line 4: why it matched ------------------------------------------- */}
      {source.excerpt && (
        <>
          <p
            className={[
              "mt-2 text-xs leading-relaxed text-muted-foreground",
              open ? "" : "line-clamp-2",
            ].join(" ")}
          >
            {source.excerpt}
          </p>
          {long && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="mt-1 rounded-sm text-2xs font-medium text-primary transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {open ? "Less" : "More"}
            </button>
          )}
        </>
      )}

      {/* --- line 5: actions --------------------------------------------------- */}
      <div className="mt-2.5 flex items-center gap-1 border-t border-[var(--border)] pt-2">
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            title="Open the original article"
            aria-label="Open the original article"
            className={ICON_BTN}
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
        {source.url && (
          <button
            type="button"
            onClick={copyLink}
            title={copied ? "Link copied" : "Copy the article link"}
            aria-label="Copy the article link"
            className={ICON_BTN}
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        )}
        {onExplain && (
          <button
            type="button"
            onClick={() => onExplain(source)}
            title="Ask the assistant to explain this source in full detail, with steps and commands"
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-2xs font-medium text-primary transition duration-150 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <Sparkles className="size-3" />
            Explain
          </button>
        )}
      </div>
    </article>
  );
}
