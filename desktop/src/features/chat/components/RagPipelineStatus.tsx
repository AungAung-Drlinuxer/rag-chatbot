/**
 * v1.6.12 — RAG Pipeline live status tracker (chat page).
 *
 * A dynamic step indicator that mirrors the real backend pipeline
 * (LangGraph stages emitted over SSE from /api/chat/stream):
 *
 *   understanding → graph (rewrite) → retrieval → rerank → generating
 *
 * - Each step lights up as the backend reports progress (stage events).
 * - Steps that already finished get a check; the active one pulses.
 * - "Interactive": hovering a step reveals what that stage actually does
 *   plus live telemetry (elapsed ms per stage) captured as events arrive.
 * - While the backend streams tokens the tracker collapses into a compact
 *   "answer streaming" pill; when done it disappears entirely.
 * - "Simulation" mode lets you demo the full flow without a backend call
 *   (used by the demo button in the EmptyChat and by unit tests).
 */
import { useEffect, useMemo, useRef, useState } from "react";


/* ------------------------------------------------------------------ */
/* Stage model                                                        */
/* ------------------------------------------------------------------ */

export type StageKey =
  | "understanding"
  | "rewrite"
  | "retrieve"
  | "rerank"
  | "generate";

type StepDef = {
  key: StageKey;
  label: string;
  icon: string;          // emoji keeps the bundle small (no icon deps)
  description: string;   // what this stage really does (hover tooltip)
};

const STEPS: StepDef[] = [
  {
    key: "understanding",
    label: "Understanding",
    icon: "🛡️",
    description:
      "Input guardrails screen the message (injection / toxicity / overflow), " +
      "the user turn is persisted, and a LangGraph run starts.",
  },
  {
    key: "rewrite",
    label: "Query rewrite",
    icon: "✏️",
    description:
      "Filler words are stripped and follow-up context is merged so the " +
      "search query is self-contained.",
  },
  {
    key: "retrieve",
    label: "Retrieval",
    icon: "🔎",
    description:
      "Hybrid search: pgvector HNSW (semantic) + BM25 keyword arm, fused " +
      "with Reciprocal Rank Fusion (k=60).",
  },
  {
    key: "rerank",
    label: "Rerank",
    icon: "🎯",
    description:
      "bge-reranker-base cross-encoder re-scores the fused candidates; " +
      "confidence ≥ 0.75 must pass the gate before an answer is generated.",
  },
  {
    key: "generate",
    label: "Generating",
    icon: "✨",
    description:
      "Context chunks + system prompt go to the primary LLM (OpenRouter) " +
      "with automatic fallback to on-prem Llama 3.2 1B.",
  },
];

/* Map free-text backend stage details onto StageKeys.
   The backend sends human strings like:
   "Analyzing your question", "Refining the search query",
   "Searching the knowledge base", "Scoring answer confidence",
   "Preparing context for the answer", "rerank failed — falling back" */
const STAGE_MATCHERS: [StageKey, RegExp][] = [
  ["understanding", /analyz|understand|guardrail|graph run/i],
  ["rewrite", /refin|rewrit|query/i],
  ["retrieve", /search|retriev|knowledge base|fus/i],
  ["rerank", /rerank|scor|confidence/i],
  ["generate", /generat|context|answer|llm|model/i],
];

export function matchStageKey(detail: string): StageKey | null {
  const d = (detail || "").toLowerCase();
  for (const [key, re] of STAGE_MATCHERS) {
    if (re.test(d)) return key;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type StageTelemetry = Partial<Record<StageKey, number>>; // ms per stage

export type RagPipelineStatusProps = {
  /** True while the request is in flight (before first token / done). */
  active: boolean;
  /** Latest backend stage detail string (from the SSE `stage` event). */
  stage: string;
  /** True once tokens start arriving. */
  streaming?: boolean;
  /** Optional per-stage elapsed-time telemetry collected by the parent. */
  telemetry?: StageTelemetry;
  /** Overall elapsed ms (parent clock). */
  elapsedMs?: number;
  /** Demo/simulation mode — walks the pipeline on a timer, no backend. */
  simulate?: boolean;
  /** Fires when the simulation finishes (so parents can reset state). */
  onSimulateDone?: () => void;
  /** v1.6.18 — render the full card with hide/show toggle (chat reply area). */
  variant?: "panel" | "card" | "inline";
  /** Initial open state */
  defaultOpen?: boolean;
};

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function RagPipelineStatus({
  active,
  stage,
  streaming = false,
  telemetry,
  elapsedMs = 0,
  simulate = false,
  onSimulateDone,
  defaultOpen = false,
}: RagPipelineStatusProps) {
  const [demoStage, setDemoStage] = useState<StageKey | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // v1.6.19 — collapsed by default once completed, or configurable via defaultOpen
  const [open, setOpen] = useState(active ? true : defaultOpen);
  const [tableOpen, setTableOpen] = useState(false);

  /* ---- simulation mode: walk the steps every 900ms ------------------ */
  useEffect(() => {
    if (!simulate) {
      setDemoStage(null);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    let i = 0;
    setDemoStage(STEPS[0].key);
    timerRef.current = setInterval(() => {
      i += 1;
      if (i < STEPS.length) {
        setDemoStage(STEPS[i].key);
      } else {
        if (timerRef.current) clearInterval(timerRef.current);
        setDemoStage(null);
        onSimulateDone?.();
      }
    }, 900);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [simulate, onSimulateDone]);

  /* ---- resolve the active step from the live backend stage ---------- */
  const liveKey: StageKey | null = useMemo(() => {
    if (simulate) return demoStage;
    if (streaming) return "generate";
    return matchStageKey(stage);
  }, [simulate, demoStage, stage, streaming]);

  // v1.6.15 - when finished (no live stage), mark everything up to the last
  // measured stage as done so the trace reads left-to-right with checks.
  const lastMeasured = useMemo(() => {
    let last = -1;
    STEPS.forEach((s, i) => {
      if (telemetry?.[s.key] != null) last = i;
    });
    return last;
  }, [telemetry]);
  const activeIdx = liveKey
    ? STEPS.findIndex((s) => s.key === liveKey)
    : lastMeasured;

  // keep rendering after completion (finished trace); only hide when nothing
  // has ever run (no active request, no telemetry, no elapsed time).
  if (!active && !simulate && elapsedMs <= 0 && !Object.keys(telemetry ?? {}).length) {
    return null;
  }

  /* ---- compact pill once the answer streams ------------------------- */
  if (streaming && !simulate) {
    return (
      <div
        data-testid="rag-pipeline-pill"
        className="flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-[10px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      >
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-600" />
        </span>
        Streaming answer
        {elapsedMs > 0 && (
          <span className="text-emerald-600/70 dark:text-emerald-400/60">
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>
    );
  }

  /* ---- full step tracker ------------------------------------------------ */
  return (
    <div
      data-testid="rag-pipeline-tracker"
      className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 text-slate-800 shadow-sm transition-all dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-100"
    >
      {/* ---- header: title + compact telemetry chips + toggle ---- */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 select-none hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`grid size-7 shrink-0 place-items-center rounded-xl text-xs ${
              active
                ? "animate-pulse bg-blue-100 text-blue-600 dark:bg-blue-950/80 dark:text-blue-400"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {active ? "⚡" : "✨"}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                RAG Pipeline
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${
                  active
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400"
                    : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
                }`}
              >
                {active ? (streaming ? "Generating" : "Tracing") : "Completed"}
              </span>
            </div>
            {!open && (
              <p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">
                {active
                  ? stage || "Processing query pipeline..."
                  : "Click to inspect step-by-step execution metrics"}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {elapsedMs > 0 && (
            <span
              data-testid="rag-pipeline-elapsed"
              className="flex items-center gap-1 rounded-lg border border-slate-200/80 bg-slate-50 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700 tabular-nums dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200"
            >
              <span className="text-[9px] font-normal uppercase text-slate-400">Time</span>
              {(elapsedMs / 1000).toFixed(1)}s
            </span>
          )}
          <span className="grid size-6 place-items-center rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            {open ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-100 p-4 dark:border-slate-800/80">
          {/* ---- horizontal bubbles with status & duration ---- */}
          <div className="flex items-start overflow-x-auto pb-3 pt-1">
            {STEPS.map((step, idx) => {
              const isActive = active && idx === activeIdx;
              const isDone = active ? activeIdx > idx : (telemetry?.[step.key] != null || idx <= lastMeasured);
              const ms = telemetry?.[step.key];
              return (
                <div key={step.key} className="flex min-w-[90px] flex-1 items-start">
                  {idx > 0 && (
                    <span
                      aria-hidden
                      className={`mx-1 mt-4 h-0.5 flex-1 shrink-0 ${
                        isDone || isActive
                          ? "bg-blue-500/80 dark:bg-blue-500/70"
                          : "bg-slate-200 dark:bg-slate-700"
                      }`}
                    />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
                    <span
                      className={`grid size-9 place-items-center rounded-full text-sm text-white shadow-xs transition-all ${
                        isActive
                          ? "animate-pulse bg-blue-600 shadow-blue-500/30"
                          : isDone
                            ? "bg-emerald-500"
                            : "bg-slate-300 dark:bg-slate-700"
                      }`}
                    >
                      {step.icon}
                    </span>
                    <span
                      className={`max-w-[85px] truncate text-[11px] font-medium ${
                        isActive
                          ? "font-semibold text-blue-600 dark:text-blue-400"
                          : isDone
                            ? "text-slate-700 dark:text-slate-200"
                            : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {step.label}
                    </span>
                    <span
                      className={`rounded-md px-1.5 py-0.2 font-mono text-[9px] tabular-nums ${
                        ms != null
                          ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          : "bg-slate-50 text-slate-300 dark:bg-slate-800/50 dark:text-slate-600"
                      }`}
                    >
                      {ms != null ? `${ms}ms` : "—"}
                    </span>
                    <span
                      className={`text-[9px] font-medium ${
                        isActive
                          ? "text-blue-600 dark:text-blue-400"
                          : isDone
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {isActive ? "◐ Running" : isDone ? "✓ Done" : "○ Pending"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ---- collapsible detail table ---- */}
          <div className="mt-2 rounded-xl border border-slate-200/80 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/40">
            <button
              type="button"
              onClick={() => setTableOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3.5 py-2 text-left"
            >
              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Detailed Telemetry Breakdown
              </span>
              <span className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                {tableOpen ? "Hide Breakdown ▲" : "Show Breakdown ▼"}
              </span>
            </button>
            {tableOpen && (
              <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800/60 dark:border-slate-800/60">
                {STEPS.map((step, idx) => {
                  const isActive = active && idx === activeIdx;
                  const isDone = active ? activeIdx > idx : (telemetry?.[step.key] != null || idx <= lastMeasured);
                  const ms = telemetry?.[step.key];
                  return (
                    <li
                      key={step.key}
                      className="flex items-center gap-2.5 px-3.5 py-2 text-xs"
                    >
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white ${
                          isActive
                            ? "bg-blue-600"
                            : isDone
                              ? "bg-emerald-500"
                              : "bg-slate-300 dark:bg-slate-700"
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="w-24 shrink-0 font-medium text-slate-800 dark:text-slate-200">
                        {step.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400 dark:text-slate-500">
                        {step.description}
                      </span>
                      <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-slate-600 dark:text-slate-300">
                        {ms != null ? `${ms}ms` : "—"}
                      </span>
                      <span
                        className={`w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-[9px] font-medium ${
                          isActive
                            ? "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400"
                            : isDone
                              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
                              : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                        }`}
                      >
                        {isActive ? "◐ Running" : isDone ? "✓ Done" : "○ Pending"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* ---- live stage detail line ---- */}
          {stage && !simulate && active && (
            <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-blue-50/60 px-3 py-1.5 text-[10px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
              <span className="size-1.5 animate-ping rounded-full bg-blue-600" />
              <span className="truncate">{stage}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function useStageTelemetry() {
  const [telemetry, setTelemetry] = useState<StageTelemetry>({});
  const [elapsed, setElapsed] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const telemetryRef = useRef<StageTelemetry>({});
  const elapsedRef = useRef<number>(0);
  const startedAt = useRef<number>(0);
  const stageAt = useRef<number>(0);
  const prevStage = useRef<StageKey | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const begin = () => {
    startedAt.current = performance.now();
    stageAt.current = startedAt.current;
    prevStage.current = null;
    telemetryRef.current = {};
    elapsedRef.current = 0;
    setTelemetry({});
    setElapsed(0);
    setStreaming(false);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      const now = performance.now();
      const lastDone = prevStage.current;
      if (lastDone) {
        const idx = STEPS.findIndex((s) => s.key === lastDone);
        const running = STEPS[idx + 1];
        if (running) {
          const runMs = Math.max(1, Math.round(now - stageAt.current));
          telemetryRef.current = { ...telemetryRef.current, [running.key]: runMs };
          setTelemetry((t) => ({ ...t, [running.key]: runMs }));
        }
      } else {
        const runMs = Math.max(1, Math.round(now - stageAt.current));
        telemetryRef.current = { ...telemetryRef.current, understanding: runMs };
        setTelemetry((t) => ({ ...t, understanding: runMs }));
      }
      const el = Math.round(now - startedAt.current);
      elapsedRef.current = el;
      setElapsed(el);
    }, 150);
  };

  const onStage = (detail: string, stageKey?: string) => {
    const now = performance.now();
    const completed = stageKey && STEPS.some((s) => s.key === stageKey)
      ? (stageKey as StageKey)
      : matchStageKey(detail);
    if (completed) {
      const runMs = Math.max(1, Math.round(now - stageAt.current));
      telemetryRef.current = { ...telemetryRef.current, [completed]: runMs };
      setTelemetry((t) => ({ ...t, [completed]: runMs }));
    }
    stageAt.current = now;
    prevStage.current = completed;
    const el = Math.round(now - startedAt.current);
    elapsedRef.current = el;
    setElapsed(el);
  };

  const onFirstToken = () => {
    const now = performance.now();
    const runMs = Math.max(1, Math.round(now - stageAt.current));
    telemetryRef.current = { ...telemetryRef.current, generate: runMs };
    setTelemetry((t) => ({ ...t, generate: runMs }));
    prevStage.current = null;
    setStreaming(true);
    const el = Math.round(now - startedAt.current);
    elapsedRef.current = el;
    setElapsed(el);
  };

  const finish = (): { stages: StageTelemetry; totalMs: number } => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    const finalElapsed = Math.round(performance.now() - startedAt.current);
    elapsedRef.current = finalElapsed;
    setElapsed(finalElapsed);
    return {
      stages: { ...telemetryRef.current },
      totalMs: finalElapsed,
    };
  };

  return { telemetry, elapsed, streaming, telemetryRef, elapsedRef, begin, onStage, onFirstToken, finish };
}
