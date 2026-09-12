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
  /** True once tokens start arriving (tracker shrinks to a pill). */
  streaming?: boolean;
  /** Optional per-stage elapsed-time telemetry collected by the parent. */
  telemetry?: StageTelemetry;
  /** Overall elapsed ms (parent clock). */
  elapsedMs?: number;
  /** Demo/simulation mode — walks the pipeline on a timer, no backend. */
  simulate?: boolean;
  /** Fires when the simulation finishes (so parents can reset state). */
  onSimulateDone?: () => void;
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
}: RagPipelineStatusProps) {
  const [demoStage, setDemoStage] = useState<StageKey | null>(null);
  const [hovered, setHovered] = useState<StageKey | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  /* ---- full step tracker -------------------------------------------- */
  return (
    <div
      data-testid="rag-pipeline-tracker"
      className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-xs backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          RAG pipeline
        </span>
        {elapsedMs > 0 && (
          <span
            data-testid="rag-pipeline-elapsed"
            className="font-mono text-[10px] text-slate-400 dark:text-slate-500"
          >
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* v1.6.15 - vertical rows for the narrow 300px sidebar:
          no truncation, no overlap; each stage shows icon + label + ms. */}
      <ol className="divide-y divide-slate-100 dark:divide-slate-800">
        {STEPS.map((step, idx) => {
          const isActive = idx === activeIdx;
          const isDone = activeIdx > idx;
          const ms = telemetry?.[step.key];

          return (
            <li key={step.key}>
              <button
                type="button"
                onMouseEnter={() => setHovered(step.key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(step.key)}
                onBlur={() => setHovered(null)}
                className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors outline-none ${
                  isActive
                    ? "bg-blue-50 dark:bg-blue-950/50"
                    : hovered === step.key
                      ? "bg-slate-50 dark:bg-slate-900"
                      : ""
                }`}
                aria-current={isActive ? "step" : undefined}
                title={step.description}
              >
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full border text-[10px] transition-all ${
                    isActive
                      ? "animate-pulse border-blue-500 bg-blue-600 text-white shadow-md shadow-blue-500/30"
                      : isDone
                        ? "border-emerald-400 bg-emerald-500 text-white"
                        : "border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
                  }`}
                >
                  {isDone ? "✓" : step.icon}
                </span>
                <span
                  className={`flex-1 truncate text-[11px] font-medium ${
                    isActive
                      ? "text-blue-700 dark:text-blue-400"
                      : isDone
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-slate-500 dark:text-slate-500"
                  }`}
                >
                  {step.label}
                </span>
                {ms != null && (
                  <span
                    className={`shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] tabular-nums dark:bg-slate-800 ${
                      isDone || isActive
                        ? "text-slate-600 dark:text-slate-300"
                        : "text-slate-300 dark:text-slate-600"
                    }`}
                  >
                    {ms}ms
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {/* hover detail card — interactive telemetry inspection */}
      {hovered && (
        <div
          data-testid="rag-pipeline-detail"
          className="mt-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"
        >
          <span className="mr-1 font-semibold text-slate-600 dark:text-slate-300">
            {STEPS.find((s) => s.key === hovered)?.icon}{" "}
            {STEPS.find((s) => s.key === hovered)?.label}:
          </span>
          {STEPS.find((s) => s.key === hovered)?.description}
          {telemetry?.[hovered] != null && (
            <span className="ml-1 font-mono text-slate-400">
              ({telemetry[hovered]}ms)
            </span>
          )}
        </div>
      )}

      {/* live stage detail line */}
      {stage && !simulate && (
        <div className="mt-1.5 truncate text-center text-[9px] italic text-slate-400 dark:text-slate-500">
          {stage}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* useStageTelemetry — hook for ChatPage to wire SSE stages to ms      */
/* ------------------------------------------------------------------ */

export function useStageTelemetry() {
  const [telemetry, setTelemetry] = useState<StageTelemetry>({});
  const [elapsed, setElapsed] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const startedAt = useRef<number>(0);
  const stageAt = useRef<number>(0);
  const prevStage = useRef<StageKey | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const begin = () => {
    startedAt.current = performance.now();
    stageAt.current = startedAt.current;
    prevStage.current = null;
    setTelemetry({});
    setElapsed(0);
    setStreaming(false);
    if (pollRef.current) clearInterval(pollRef.current);
    // v1.6.13 — poll every 150ms: show a live "running…" duration for the
    // stage that is currently executing (the one AFTER the last completed
    // label), so the active row's ms counts up in real time.
    pollRef.current = setInterval(() => {
      const now = performance.now();
      const lastDone = prevStage.current;
      if (lastDone) {
        const idx = STEPS.findIndex((s) => s.key === lastDone);
        const running = STEPS[idx + 1];
        if (running) {
          const runMs = Math.max(1, Math.round(now - stageAt.current));
          setTelemetry((t) => ({ ...t, [running.key]: runMs }));
        }
      } else {
        // before the first label completes, "understanding" is running
        const runMs = Math.max(1, Math.round(now - stageAt.current));
        setTelemetry((t) => ({ ...t, understanding: runMs }));
      }
      setElapsed(Math.round(now - startedAt.current));
    }, 150);
  };

  const onStage = (detail: string, stageKey?: string) => {
    // v1.6.16 — the backend now sends an exact canonical stage key with every
    // stage event; fall back to detail matching for older payloads. Unknown
    // keys (aliases/typos) are ignored so the 5 canonical rows stay exact.
    const now = performance.now();
    const completed = stageKey && STEPS.some((s) => s.key === stageKey)
      ? (stageKey as StageKey)
      : matchStageKey(detail);
    if (completed) {
      const runMs = Math.max(1, Math.round(now - stageAt.current));
      setTelemetry((t) => ({ ...t, [completed]: runMs }));
    }
    stageAt.current = now;
    prevStage.current = completed;
    setElapsed(Math.round(now - startedAt.current));
  };

  const onFirstToken = () => {
    // tokens start → whatever was running since the last label is "generating"
    const now = performance.now();
    const runMs = Math.max(1, Math.round(now - stageAt.current));
    setTelemetry((t) => ({ ...t, generate: runMs }));
    prevStage.current = null;
    setStreaming(true);
    setElapsed(Math.round(now - startedAt.current));
  };

  const finish = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setElapsed(Math.round(performance.now() - startedAt.current));
  };

  return { telemetry, elapsed, streaming, begin, onStage, onFirstToken, finish };
}
