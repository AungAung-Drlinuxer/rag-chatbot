/**
 * MarkdownMessage — one renderer for every AI answer (v1.6.45).
 *
 * Why a shared component: the chat page and the floating AI Assistant each had
 * their own ReactMarkdown call with a long, drifting Tailwind class chain, so
 * answers looked subtly different in the two surfaces. This module owns the
 * presentation once.
 *
 * What it adds over a bare <ReactMarkdown>:
 *   • CODE BLOCKS with a Copy button, a language badge and a distinct surface.
 *     Commands are the main reason someone copies from an answer, so copy has to
 *     be one click and must not depend on selecting text by hand. The block is
 *     also horizontally scrollable and never wraps mid-command.
 *   • Inline code, headings, lists, tables and links styled to match the app.
 *   • `media` — an optional smaller scale for the 380px floating widget.
 */
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

function CodeBlock({
  children,
  className,
  compact,
  ...rest
}: HTMLAttributes<HTMLPreElement> & { compact?: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  // Read the rendered text rather than walking the markdown AST — works for any
  // code shape (fences, indented blocks, tables) and cannot drift from what the
  // user actually sees.
  function copy() {
    const text = ref.current?.innerText ?? "";
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else {
      // Fallback for a non-secure context where the Clipboard API is unavailable.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* best effort */ }
      document.body.removeChild(ta);
      done();
    }
  }

  const lang = /language-([\w+#-]+)/.exec(className || "")?.[1];

  return (
    <div className="group/code relative my-2.5 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/70">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-100/70 px-2.5 py-1 dark:border-slate-800 dark:bg-slate-800/50">
        <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-slate-500 transition hover:bg-white hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
        >
          {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        ref={ref}
        className={`overflow-x-auto px-3 py-2.5 font-mono ${compact ? "text-[10px]" : "text-[11px]"} leading-relaxed text-slate-800 dark:text-slate-100`}
        {...rest}
      >
        {children}
      </pre>
    </div>
  );
}

const BASE = [
  "md min-w-0 max-w-full break-words [overflow-wrap:anywhere] leading-relaxed",
  "[&_p]:my-2 [&_strong]:font-semibold",
  "[&_ul]:list-disc [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_li]:ml-4",
  "[&_a]:text-blue-600 [&_a]:underline dark:[&_a]:text-blue-400",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 dark:[&_blockquote]:border-slate-700",
  "[&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-slate-600 dark:[&_blockquote]:text-slate-300",
  "[&_code]:rounded [&_code]:bg-[var(--muted)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] dark:[&_code]:bg-slate-800",
  // Desktop keeps a real table. The `md-stack` class takes over below 640px (see
  // styles.css) and turns each row into a labelled block, because a sideways-scrolling
  // table on a phone hides precisely the columns that matter.
  "[&_table]:w-full [&_table]:border-separate [&_table]:border-spacing-0 [&_table]:text-left",
  "[&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:align-top",
  "dark:[&_th]:border-slate-800 dark:[&_th]:bg-slate-800/80",
  "[&_td]:border-b [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:whitespace-nowrap dark:[&_td]:border-slate-800/60",
  "[&_tr:last-child_td]:border-b-0",
  "[&_hr]:my-4 [&_hr]:border-slate-200 dark:[&_hr]:border-slate-800",
].join(" ");

/** Header labels of the table currently being rendered, for the mobile stacked layout. */
const TableLabels = createContext<string[]>([]);

/** Concatenate the text inside a React children tree (a <th>'s label). */
function textOf(node: ReactNode): string {
  let out = "";
  Children.forEach(node, (child) => {
    if (typeof child === "string" || typeof child === "number") out += String(child);
    else if (isValidElement(child)) out += textOf((child.props as { children?: ReactNode }).children);
  });
  return out.trim();
}

/**
 * Read the header labels out of the table's own <thead>.
 *
 * Deliberately derived from the rendered tree rather than hardcoded: the backend emits
 * several different tables (8 columns for Proxmox guests, 6 for Kubernetes nodes, 7 for
 * datastores) and will emit more, so a label list baked into the component would silently
 * mislabel the next shape that appears.
 */
function headerLabels(children: ReactNode): string[] {
  const out: string[] = [];
  const walk = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const tag = child.type as unknown as string;
      const kids = (child.props as { children?: ReactNode }).children;
      if (tag === "th") { out.push(textOf(kids)); return; }
      walk(kids);
    });
  };
  walk(children);
  return out;
}

/**
 * A table row. Adds `data-label` to every cell from the table's header row so the mobile
 * stacked layout can print the column name beside the value — that is what lets 8 columns
 * stay readable at 390px without sideways scrolling.
 *
 * Defined at MODULE level, not inline in the `components` object: an inline definition is a
 * new component type on every render, so React would unmount and remount every row (losing
 * text selection and any in-row state).
 */
function TableRow({ children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  const labels = useContext(TableLabels);
  let i = -1;
  const cells = Children.map(children as ReactNode, (child) => {
    if (isValidElement(child) && (child.type as unknown as string) === "td") {
      i += 1;
      return cloneElement(child as React.ReactElement<{ "data-label"?: string }>, {
        "data-label": labels[i] ?? "",
      });
    }
    return child;
  });
  return <tr {...rest}>{cells}</tr>;
}

/** A markdown table: a real table when it fits, labelled blocks when it does not.
 *
 * The decision is a MEASUREMENT, not a breakpoint, because the chat bubble can be 768px on
 * a 1440px monitor and an 8-column guest table overflows it just as badly as it does a
 * phone — and at both widths the failure looked identical: rightmost columns gone at a
 * clipped edge with nothing to hint they existed.
 *
 * The wrapper carries `md-stack-active`; styles.css does the rest off that one class, so
 * the table itself is never mutated (no losing the measure to the layout it causes).
 */
function Table({ children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  const labels = headerLabels(children as ReactNode);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [stack, setStack] = useState(false);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const table = wrap.querySelector("table");
    if (!table) return;

    /**
     * Measure the table's NATURAL width, which is not what it reports while stacked: the
     * stacked layout is narrow by construction, so reading scrollWidth as-is would always
     * look like it fits and the layout would flip back. Toggling the class off, measuring
     * and toggling it on again happens synchronously inside a layout effect, so the browser
     * never paints the intermediate state.
     */
    const measure = () => {
      const stacked = wrap.classList.contains("md-stack-active");
      if (stacked) wrap.classList.remove("md-stack-active");
      const natural = table.scrollWidth;
      if (stacked) wrap.classList.add("md-stack-active");
      setStack(natural > wrap.clientWidth + 2);
    };

    measure();
    // Re-measure on ANY size change — of the wrapper (window resize, sidebar collapse,
    // font-size preference) and of the TABLE itself.
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(table);
    // Web fonts land AFTER first paint and widen the table without changing the wrapper, so
    // a single mount-time measurement stuck with the wrong answer: measured flapping
    // between stacked and not-stacked across runs at 390px, with up to 36 cells off-screen.
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) measure(); }).catch(() => {});
    // Last-resort settle for late layout (images, late CSS).
    const t = window.setTimeout(measure, 400);
    return () => { cancelled = true; ro.disconnect(); window.clearTimeout(t); };
  }, [children]);

  return (
    <TableLabels.Provider value={labels}>
      <div
        ref={wrapRef}
        data-stacked={stack ? "1" : "0"}
        className={`md-stack-wrap my-3 max-w-full overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800${
          stack ? " md-stack-active" : ""
        }`}
      >
        <table {...rest}>{children as ReactNode}</table>
      </div>
    </TableLabels.Provider>
  );
}

export default function MarkdownMessage({
  content,
  compact = false,
  className = "",
}: {
  content: string;
  /** tighter type scale + spacing for the floating widget */
  compact?: boolean;
  className?: string;
}) {
  const heading = compact
    ? "[&_h1]:mt-2.5 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-2.5 [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-xs [&_h3]:font-semibold"
    : "[&_h1]:mt-3 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-xs [&_h3]:font-semibold";

  return (
    <div className={`${BASE} ${heading} ${compact ? "text-xs" : "text-xs"} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // react-markdown v9 passes the <code> child through `children`; wrapping
          // `pre` is what lets us attach the copy affordance to the whole block.
          pre: (props) => <CodeBlock {...(props as HTMLAttributes<HTMLPreElement>)} compact={compact} />,
          // Tables: a real table on desktop, labelled blocks below 640px. See Table /
          // TableRow above and the .md-stack rules in styles.css.
          table: (props) => <Table {...(props as HTMLAttributes<HTMLTableElement>)} />,
          tr: (props) => <TableRow {...(props as HTMLAttributes<HTMLTableRowElement>)} />,
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children as ReactNode}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
