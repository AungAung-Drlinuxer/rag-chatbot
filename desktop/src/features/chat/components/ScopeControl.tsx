/**
 * ScopeControl — which connectors THIS conversation may use.
 *
 * WHY IT EXISTS, measured: a question names one system and the answer touched two.
 * "Loki က label ဘာတွေရှိလဲ" ran on [grafana, rancher] and "Proxmox VMs list ပြပါ" on
 * [proxmox, rancher] — the Kubernetes paths ask Rancher for a cluster id even when the
 * question is not about Kubernetes, so the evidence card credited a server the question had
 * nothing to do with and the turn paid an extra round trip for it.
 *
 * WHY A POPOVER, NOT A ROW OF CHIPS: the app is driven from a phone, and a variable-width
 * row of chips is exactly the thing that widened a card to 442px inside a 390px viewport
 * elsewhere in this app. A single fixed-label button cannot do that, and the options appear
 * on demand — the same reasoning as ComposerControls.
 *
 * WHY IT HIDES ITSELF: an end user's role gets `can_scope: false` and never sees it, and in
 * knowledge-base mode scoping connectors is meaningless. Keeping it visible-but-dead would
 * be a control that does nothing, which reads as a bug.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plug } from "lucide-react";

export type McpServer = { name: string; label: string; curated: boolean };

/** Server names the UI prettifies — the API sends the wire name, which is lowercase. */
const PRETTY: Record<string, string> = {
  rancher: "Rancher",
  proxmox: "Proxmox",
  grafana: "Grafana",
  postgres: "PostgreSQL",
  gitea: "Gitea",
};

/** The pill's text. Exported because it is the whole contract, and the rules are not
 *  obvious from reading the JSX:
 *
 *  · an EMPTY selection reads "All connectors" — never "0" or blank. An empty array is
 *    how "unscoped" is spelled on the wire (streamChat omits the key entirely), so a
 *    label implying NO connectors would describe the opposite of what happens.
 *  · a single selection uses the display name, so the lowercase API token (`rancher`)
 *    never reaches the UI.
 *  · several collapse to "first +N" — a variable-width list of chips is what widened a
 *    card past 390px elsewhere in this app, and this pill must stay one fixed width.
 */
export function scopeLabel(value: string[]): string {
  if (value.length === 0) return "All connectors";
  const first = PRETTY[value[0]] ?? value[0];
  return value.length === 1 ? first : `${first} +${value.length - 1}`;
}
export default function ScopeControl({
  servers, value, onChange, className = "",
}: {
  servers: McpServer[];
  /** Selected server names. EMPTY = every connector, which is the default and the safe one. */
  value: string[];
  onChange: (v: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Horizontal correction for the popover, in px. MEASURED, not guessed: the same
  // component sits at the LEFT of the desktop composer row and at the RIGHT edge of
  // the phone header, so one hardcoded side overflows in the other place.
  // Measured before the fix: at 390px the phone header pill put the 256px popover at
  // x=254, so it ran to 510 and widened the document to scrollWidth 510 (vs 390).
  const [shift, setShift] = useState(0);
  // Which side of the pill the popover opens on. Also MEASURED: the same component sits in
  // the chat HEADER (top of the screen) and in the composer row (bottom), and a fixed
  // `bottom-full` opened the header one above the viewport entirely — the popover existed,
  // reported open, and was invisible. Horizontal clamping alone did not catch it.
  const [drop, setDrop] = useState<"up" | "down">("up");
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

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

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = popRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const M = 8;                       // keep an 8px gutter off both screen edges
      let dx = 0;
      if (r.right > vw - M) dx = (vw - M) - r.right;   // pinned past the right edge
      if (r.left + dx < M) dx = M - r.left;            // ...and not off the left one
      setShift(dx);
      // Vertical: if opening upward would clip the top, open downward instead. r.top is
      // measured in whichever direction the popover is currently rendered, so the test
      // is "is it inside the viewport right now" rather than an assumption about where
      // the pill sits.
      setDrop((d) => {
        if (r.top < M) return "down";
        if (r.bottom > window.innerHeight - M) return "up";
        return d;
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  if (!servers.length) return null;

  const toggle = (name: string) => {
    const next = value.includes(name) ? value.filter((n) => n !== name) : [...value, name];
    onChange(next);
  };

  const label = scopeLabel(value);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Connectors: ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex max-w-[11rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
          open
            ? "border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            : "border-transparent bg-slate-100/80 text-slate-500 hover:bg-slate-200/80 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:bg-slate-800"
        }`}
      >
        <Plug className={`size-3 shrink-0 ${value.length ? "text-violet-500" : ""}`} />
        <span className="truncate">{label}</span>
        <svg viewBox="0 0 20 20" className="h-2.5 w-2.5 shrink-0 opacity-50" fill="currentColor">
          <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="2"
                fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          ref={popRef}
          style={{ left: shift }}
          className={`absolute z-30 w-64 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900 ${
            drop === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
          }`}
          role="listbox"
          aria-multiselectable="true"
        >
          <div className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
            Connectors this chat may use
          </div>

          <button
            type="button"
            role="option"
            aria-selected={value.length === 0}
            onClick={() => { onChange([]); setOpen(false); }}
            className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
              value.length === 0 ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
            }`}
          >
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
              value.length === 0 ? "bg-violet-500" : "bg-slate-300 dark:bg-slate-600"}`} />
            <span className="min-w-0">
              <span className="block text-[11px] font-medium text-slate-700 dark:text-slate-200">All connectors</span>
              <span className="mt-0.5 block text-[10px] leading-snug text-slate-400">
                Any enabled server — the default
              </span>
            </span>
          </button>

          {servers.map((s) => {
            const on = value.includes(s.name);
            return (
              <button
                key={s.name}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(s.name)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                  on ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                }`}
              >
                {/* A tick, not a radio: this list is multi-select and a dot would read as one. */}
                <span className={`grid size-3 shrink-0 place-items-center rounded-[4px] border ${
                  on ? "border-violet-500 bg-violet-500 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                  {on && (
                    <svg viewBox="0 0 20 20" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M4 10.5 8 14.5 16 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">
                  {PRETTY[s.name] ?? s.name}
                </span>
              </button>
            );
          })}

          <p className="px-2.5 pb-1 pt-1.5 text-[9px] leading-snug text-slate-400">
            Restricting the scope removes the connectors a question would otherwise touch by
            accident. It never grants access a connector does not already have.
          </p>
        </div>
      )}
    </div>
  );
}