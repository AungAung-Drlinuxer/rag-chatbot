/**
 * MessageParts — small presentational pieces of a chat message, extracted from
 * ChatPage.tsx (v1.6.68) so the page file stops carrying them.
 */
import { Sparkles } from "lucide-react";

import { type Source } from "@/features/chat/model";

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const high = confidence >= 85;
  const medium = confidence >= 70 && confidence < 85;
  return (
    <span
      className={[
        "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
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

export function SourceCard({
  source,
  index,
  onExplain,
}: {
  source: Source;
  index: number;
  /** Ask the assistant to expand this specific source in full detail. */
  onExplain?: (source: Source) => void;
}) {
  const body = (
    <>
      <div className="flex items-start gap-3">
        <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-50 text-[10px] font-semibold text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
          {index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[10px] font-semibold">{source.title}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">{source.space}</div>
        </div>
      </div>
      {source.relevance == null ? (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Type</span>
          <span className="text-[10px] font-semibold text-blue-600">Ticket</span>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Relevance</span>
          <span className="text-[10px] font-semibold text-emerald-600">{source.relevance}%</span>
        </div>
      )}
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${source.relevance}%` }} />
      </div>
      <p className="mt-3 line-clamp-3 text-[10px] leading-4 text-muted-foreground">{source.excerpt}</p>
    </>
  );
  // The action row lives OUTSIDE the anchor: a <button> nested in an <a> is
  // invalid HTML, and clicking it would also trigger the link navigation.
  const explainRow = onExplain ? (
    <button
      type="button"
      onClick={() => onExplain(source)}
      className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/60 px-2 py-1.5 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
      title="Ask the assistant to explain this source in full detail, with steps and commands"
    >
      <Sparkles className="size-3" />
      Explain this source in detail
    </button>
  ) : null;

  const card = source.url ? (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      className="block w-full rounded-xl border bg-white p-3 text-left transition hover:border-blue-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      {body}
    </a>
  ) : (
    <div className="w-full rounded-xl border bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      {body}
    </div>
  );

  return (
    <div className="mb-3">
      {card}
      {explainRow}
    </div>
  );
}

