/**
 * Settings (Integrations + Connectors) render harness.
 *
 * WHY: both surfaces live behind auth, so the only way to check them without signing in is
 * to render the REAL components with `fetch` stubbed. Nothing is mocked or duplicated —
 * `IntegrationsConfig` and `ConnectorsGallery` are the shipping components, and the
 * connector list comes from `public/anytype_connectors_fixture.json`, which is generated
 * from the real `backend/app/mcp/catalog.py` so the two cannot drift.
 *
 * Exposes `window.__SETTINGS_HARNESS__` for the shot script to drive and measure, and
 * `window.__SETTINGS_REQS__` with every request URL in order — that log is what proves the
 * Anytype tab is wired to the real endpoint rather than to a label.
 */
// Tailwind lives in styles.css. Every other harness imports it; this one did not, so the
// connector dialog rendered as `position: static` with a transparent background and every
// layout measurement below was meaningless. Text assertions happened to stay valid, which
// is exactly how a missing stylesheet goes unnoticed — hence this comment.
import "./styles.css";

import { createRoot } from "react-dom/client";
import { IntegrationsConfig } from "@/features/settings/components/IntegrationsConfig";
import ConnectorsGallery from "@/features/settings/components/ConnectorsGallery";

const reqs: string[] = [];
(window as any).__SETTINGS_REQS__ = reqs;

const origFetch = window.fetch.bind(window);
window.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  const method = init?.method ?? "GET";
  reqs.push(`${method} ${url}`);

  let body: any = {};
  if (/\/api\/connectors$/.test(url)) {
    // Served from public/ through the real fetch, so the fixture cannot be bypassed.
    const r = await origFetch("/anytype_connectors_fixture.json");
    body = await r.json();
  } else if (/\/api\/settings\/integrations\/llm\/models/.test(url)) {
    // The real endpoint reads the SAVED key. Detection is only expected to fire when a key
    // is stored, so the stub records the call and answers with a plausible catalogue.
    body = {
      models: [
        { id: "cline-pass/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
        { id: "cline-pass/kimi-k3.1-pro", name: "Kimi K3.1 Pro" },
        { id: "cline-pass/qwen3.8-flash", name: "Qwen 3.8 Flash" },
        { id: "cline-pass/glm-5-air", name: "GLM 5 Air" },
        { id: "cline-pass/minimax-m3", name: "MiniMax M3" },
        { id: "cline-pass/mimo-9b", name: "MiMo 9B" },
      ],
      count: 6,
      source: "clinepass",
    };
  } else if (/\/api\/settings\/integrations\/llm$/.test(url)) {
    // A stored key: this is what makes auto-detection possible.
    body = {
      settings: { provider: "clinepass", model: "cline-pass/deepseek-v4.1-flash" },
      fields_set: ["provider", "base_url", "api_key", "model"],
      secret_fields: ["api_key"],
      token_set: true,
      updated_at: "2026-10-31T05:00:00Z",
    };
  } else if (/\/api\/settings\/integrations\//.test(url)) {
    body = { fields_set: [], secret_fields: [], updated_at: null };
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof window.fetch;

function App() {
  return (
    <div className="min-h-screen space-y-10 p-6">
      <section id="integrations">
        <h2 className="mb-3 text-sm font-semibold text-slate-500">Settings → Integrations</h2>
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <IntegrationsConfig />
        </div>
      </section>
      <section id="connectors">
        <h2 className="mb-3 text-sm font-semibold text-slate-500">Settings → Connectors</h2>
        <ConnectorsGallery />
      </section>
    </div>
  );
}

const host = document.getElementById("root")!;
createRoot(host).render(<App />);

(window as any).__SETTINGS_HARNESS__ = {
  integrationTabs(): string[] {
    const root = document.querySelector("#integrations")!;
    return [...root.querySelectorAll("button")]
      .map((b) => (b.textContent ?? "").trim())
      .filter((s) => s.length > 0 && s.length < 30);
  },

  selectIntegration(label: string): boolean {
    const root = document.querySelector("#integrations")!;
    const btn = [...root.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === label,
    ) as HTMLElement | undefined;
    if (!btn) return false;
    btn.click();
    return true;
  },

  /** The visible field list of the active integration panel, in render order.
   *
   *  Fields are laid out in one grid PER GROUP, so querying a single `div.grid` returns
   *  only the first group's fields — which silently truncated this list to "Connection"
   *  when the grouped layout landed. Walk every section instead. */
  fields(): { label: string; type: string | null }[] {
    const root = document.querySelector("#integrations")!;
    const out: { label: string; type: string | null }[] = [];
    for (const sec of root.querySelectorAll("section")) {
      const grid = sec.querySelector("div.grid");
      if (!grid) continue;
      for (const w of grid.children) {
        const label = (w.querySelector("label")?.textContent ?? "").trim();
        if (!label) continue;
        const input = w.querySelector("input, select, textarea");
        out.push({
          label,
          type: input ? (input.getAttribute("type") ?? input.tagName.toLowerCase()) : null,
        });
      }
    }
    return out;
  },

  /** Description paragraph of the active integration panel. */
  desc(): string {
    const root = document.querySelector("#integrations")!;
    const ps = [...root.querySelectorAll("p")].map((p) => (p.textContent ?? "").trim());
    return ps.sort((a, b) => b.length - a.length)[0] ?? "";
  },

  connectors(): Record<string, unknown> {
    const root = document.querySelector("#connectors")!;
    const text = (root.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      headings: [...root.querySelectorAll("h1,h2,h3,h4")].map((h) => (h.textContent ?? "").trim()),
      cardCount: root.querySelectorAll("button, [role=button]").length,
      hasAnytype: /Anytype/.test(text),
      hasKnowledgeGroup: /Knowledge/.test(text),
      hasStdioNote: /stdio only/.test(text),
      hasVersionNote: /Anytype-Version/.test(text),
      hasPortNote: /31009/.test(text),
      text: text.slice(0, 1200),
    };
  },

  /** Open a connector's setup form. The catalogue `note` only renders inside the
   *  ConnectDialog, so the note assertions have to look after this is called.
   *  The card's action is an icon-only button, so it is matched by aria-label
   *  ("Connect Anytype") — matching on textContent finds nothing. */
  openConnector(name: string): boolean {
    const root = document.querySelector("#connectors")!;
    const el = [...root.querySelectorAll("button")].find(
      (e) =>
        (e.getAttribute("aria-label") ?? "").includes(name) ||
        (e.textContent ?? "").includes(name),
    ) as HTMLElement | undefined;
    if (!el) return false;
    el.click();
    return true;
  },

  /** Whole-page text — the dialog's own wrapper is an implementation detail. */
  bodyText(): string {
    return (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
  },

  /** Is the app stylesheet actually applied? A harness that forgets `./styles.css`
   *  renders unstyled and every geometry number becomes meaningless, so this is
   *  asserted rather than assumed. */
  styles(): Record<string, unknown> {
    const body = getComputedStyle(document.body);
    const probe = document.createElement("div");
    probe.className = "fixed inset-0 z-50";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const out = {
      bodyBg: body.backgroundColor,
      fixedApplies: cs.position === "fixed",
      insetApplies: cs.top === "0px",
      zIndexApplies: cs.zIndex === "50",
    };
    probe.remove();
    return out;
  },

  /** The open ConnectDialog overlay: is it really painted over the viewport? */
  dialogBox(): Record<string, unknown> | null {
    const el = document.querySelector(".fixed.inset-0");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      position: cs.position,
      zIndex: cs.zIndex,
      bg: cs.backgroundColor,
      top: Math.round(r.top),
      height: Math.round(r.height),
      coversViewport: r.top <= 1 && r.height >= window.innerHeight - 1,
      inViewport: r.top < window.innerHeight,
    };
  },

  /** Nav rail entries, in render order. */
  nav(): string[] {
    const root = document.querySelector("#integrations")!;
    return [...root.querySelectorAll("nav button")].map((b) => (b.textContent ?? "").trim());
  },

  /** Section headings of the active panel — the Connection/Credentials/Options groups. */
  panelGroups(): string[] {
    const root = document.querySelector("#integrations")!;
    return [...root.querySelectorAll("section h4")].map((h) => (h.textContent ?? "").trim());
  },

  /** Which group each rendered field landed in, keyed by its label. */
  fieldGroups(): Record<string, string> {
    const root = document.querySelector("#integrations")!;
    const out: Record<string, string> = {};
    for (const sec of root.querySelectorAll("section")) {
      const g = (sec.querySelector("h4")?.textContent ?? "").trim();
      for (const lab of sec.querySelectorAll("label")) {
        out[(lab.textContent ?? "").trim()] = g;
      }
    }
    return out;
  },

  /** Security attributes on the password inputs — the ones that must not be treated as a
   *  site login by the browser or a password manager. */
  secretInputs(): Record<string, unknown>[] {
    const root = document.querySelector("#integrations")!;
    return [...root.querySelectorAll("input[type=password]")].map((i) => ({
      placeholder: i.getAttribute("placeholder"),
      autoComplete: i.getAttribute("autocomplete"),
      spellCheck: i.getAttribute("spellcheck"),
      autoCorrect: i.getAttribute("autocorrect"),
      onePwIgnore: i.hasAttribute("data-1p-ignore"),
      lastPassIgnore: i.getAttribute("data-lpignore"),
    }));
  },

  /** Click the reveal toggle for a named secret field, then report the input types. */
  toggleReveal(label: string): boolean {
    const root = document.querySelector("#integrations")!;
    const btn = [...root.querySelectorAll("button")].find(
      (b) => (b.getAttribute("aria-label") ?? "").includes(label),
    ) as HTMLElement | undefined;
    if (!btn) return false;
    btn.click();
    return true;
  },

  /** Everything the model picker is showing. */
  modelPanel(): Record<string, unknown> {
    const root = document.querySelector("#integrations")!;
    const filter = root.querySelector("input[placeholder^='Filter'], input[placeholder*='models detected']");
    const rows = [...root.querySelectorAll("div.max-h-52 button")];
    const detected = [...root.querySelectorAll("p")].map((p) => (p.textContent ?? "").trim())
      .find((x) => /auto-detected/.test(x)) ?? null;
    const selected = rows.find((r) => r.className.includes("bg-sky-50"))?.textContent?.trim() ?? null;
    return {
      hasFilter: !!filter,
      rowCount: rows.length,
      rows: rows.map((r) => (r.textContent ?? "").trim()).slice(0, 10),
      detectedLine: detected,
      selected,
    };
  },

  /** Type into the model filter box the way a user would (React-controlled input). */
  filterModels(q: string): boolean {
    const root = document.querySelector("#integrations")!;
    const el = root.querySelector("input[placeholder^='Filter']") as HTMLInputElement | undefined;
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, q);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  },

  /** Click a model row. */
  pickModel(id: string): boolean {
    const root = document.querySelector("#integrations")!;
    const row = [...root.querySelectorAll("div.max-h-52 button")].find(
      (b) => (b.textContent ?? "").trim() === id,
    ) as HTMLElement | undefined;
    if (!row) return false;
    row.click();
    return true;
  },

  /** The value of the free-text model input. */
  customModelValue(): string | null {
    const root = document.querySelector("#integrations")!;
    const el = root.querySelector("input[placeholder='or type a model id']") as HTMLInputElement | null;
    return el ? el.value : null;
  },

  overflow(): { scrollW: number; clientW: number } {
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  },
};
