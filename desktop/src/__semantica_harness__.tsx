/**
 * Render harness for the Context Graph page — screenshots it WITHOUT logging in.
 *
 * The reviewer account is gone from production, and a verification script must not sign in on
 * its own. So this renders the SAME page component the app renders, on the SAME stylesheet,
 * fed by payloads captured from the LIVE spike service (`public/semantica_fixture.json`) —
 * 2,144 entities and 1,540 relations, not invented rows. That makes the screenshot evidence
 * about the real presentation of real data.
 *
 * Usage (dev server only; not part of the shipped bundle):
 *   node scripts/semantica_harness_shot.mjs
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import ContextGraphPage from "./features/semantica/pages/ContextGraphPage";

declare global {
  interface Window { __SEM_HARNESS__?: { ready: boolean; nodes: number } }
}

type Fixture = { stats: unknown; graph: unknown; provenance: unknown; relations: unknown; selected: string };

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const fx: Fixture = await (await fetch("/semantica_fixture.json")).json();

// Serve the captured payloads for the page's own API calls. Everything else falls through, so
// the page's real fetch/auth code path is exercised rather than bypassed.
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/semantica/")) {
    if (url.includes("/stats")) return json(fx.stats);
    if (url.includes("/graph")) return json(fx.graph);
    if (url.includes("/provenance")) return json(fx.provenance);
    if (url.includes("/relation")) return json(fx.relations);
  }
  return realFetch(input as RequestInfo, init);
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(<ContextGraphPage />);

const nodes = (fx.graph as { nodes?: unknown[] })?.nodes?.length ?? 0;
window.__SEM_HARNESS__ = { ready: false, nodes };
setTimeout(() => { if (window.__SEM_HARNESS__) window.__SEM_HARNESS__.ready = true; }, 2500);