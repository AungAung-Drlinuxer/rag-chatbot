/**
 * ComposerControls — the two composer settings, as ONE quiet row.
 *
 * WHY THIS REPLACED THE CHIP ROWS
 * The previous design rendered six pills across two rows (AI Engine: Auto / Cloud
 * only / Local only, plus Answer from: Auto / Knowledge base / Infrastructure) with
 * inline hint text. On a phone that wrapped and clipped ("Infrastructure" was cut
 * off, "live cluster · read-only" overflowed), and six coloured pills above every
 * input is visual noise for settings that change once a session — the opposite of
 * the borderless, soft-panel look the rest of the app aims for.
 *
 * Now: two compact dropdown buttons, each showing only the CURRENT value. The
 * options and their explanations appear on demand. One row, short labels, no
 * wrapping, and the active state carries the only colour.
 */
import { useEffect, useRef, useState } from "react";

export type Option<T extends string> = {
  value: T;
  label: string;
  hint?: string;
};

type Props<T extends string> = {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (v: T) => void;
  /** Tint for the active dot — infrastructure mode is deliberately green. */
  accent?: "blue" | "emerald";
  /** Rendered after the button, e.g. a compact "live" marker. */
  trailing?: React.ReactNode;
};

function Select<T extends string>({
  label, value, options, onChange, accent = "blue", trailing,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  // Close on outside click / Escape so the menu never traps the composer.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dot = accent === "emerald" ? "bg-emerald-500" : "bg-blue-500";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${label}: ${current.label}`}
        className={`inline-flex max-w-[9.5rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
          open
            ? "border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            : "border-transparent bg-slate-100/80 text-slate-500 hover:bg-slate-200/80 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:bg-slate-800"
        }`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate">{current.label}</span>
        <svg viewBox="0 0 20 20" className="h-2.5 w-2.5 shrink-0 opacity-50" fill="currentColor">
          <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="2"
                fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 z-30 mb-1.5 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          role="listbox"
        >
          <div className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
            {label}
          </div>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                o.value === value
                  ? "bg-slate-100 dark:bg-slate-800"
                  : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
              }`}
            >
              <span
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  o.value === value ? (accent === "emerald" ? "bg-emerald-500" : "bg-blue-500")
                                    : "bg-slate-300 dark:bg-slate-600"
                }`}
              />
              <span className="min-w-0">
                <span className="block text-[11px] font-medium text-slate-700 dark:text-slate-200">
                  {o.label}
                </span>
                {o.hint && (
                  <span className="mt-0.5 block text-[10px] leading-snug text-slate-400">
                    {o.hint}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      {trailing}
    </div>
  );
}

export default function ComposerControls({
  mode, onModeChange, engine, onEngineChange,
}: {
  mode: "auto" | "kb" | "infra";
  onModeChange: (v: "auto" | "kb" | "infra") => void;
  engine: "auto" | "cloud" | "local";
  onEngineChange: (v: "auto" | "cloud" | "local") => void;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 px-1">
      <Select
        label="Answer from"
        value={mode}
        onChange={onModeChange}
        accent={mode === "infra" ? "emerald" : "blue"}
        options={[
          { value: "auto", label: "Auto", hint: "Documents, or the live estate when the question is about it" },
          { value: "kb", label: "Knowledge base", hint: "Documents only — infrastructure tools are never used" },
          { value: "infra", label: "Infrastructure", hint: "Live Kubernetes / Rancher, read-only. Admin or agent role" },
        ] as const}
        trailing={
          mode === "infra" ? (
            <span className="text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
              ⚡ live
            </span>
          ) : undefined
        }
      />
      <Select
        label="AI engine"
        value={engine}
        onChange={onEngineChange}
        options={[
          { value: "auto", label: "Auto", hint: "Hosted model first, on-prem Ollama as fallback" },
          { value: "cloud", label: "Cloud only", hint: "Never fall back to the local model" },
          { value: "local", label: "Local only", hint: "On-prem Ollama — air-gap or cost saving" },
        ] as const}
        trailing={
          engine === "local" ? (
            <span className="text-[9px] font-medium text-amber-600 dark:text-amber-400">
              ⚠ slower
            </span>
          ) : undefined
        }
      />
    </div>
  );
}
