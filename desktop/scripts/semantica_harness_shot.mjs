// Screenshot the Context Graph page at desktop and phone widths, on real captured payloads.
//
// Why a harness instead of the running app: the page is admin-only and verification must not
// sign in as anyone. The harness renders the same component with the same stylesheet, fed by
// payloads captured from the live semantica-spike service.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5201;
const URL = `http://localhost:${PORT}/semantica-harness.html`;

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true, stdio: "pipe", cwd: process.cwd(),
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

async function reachable(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}
let up = false;
for (let i = 0; i < 60 && !up; i++) { up = await reachable(URL); if (!up) await sleep(1000); }
if (!up) { dev.kill(); throw new Error(`harness server not reachable at ${URL}`); }
await sleep(2000);

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const report = {};
for (const [name, vp, shot] of [
  ["desktop", { width: 1440, height: 1000 }, "semantica_graph_desktop"],
  ["mobile", { width: 390, height: 844 }, "semantica_graph_mobile"],
]) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.setViewport({ ...vp, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });

  // Let the force simulation settle: nodes are placed over ticks, so an early shot is a blur.
  await sleep(3500);

  // Select the top entity so the provenance/connections panel is populated in the shot — it is
  // the part of this page actually worth evaluating.
  await page.evaluate(() => {
    const row = document.querySelector("table tbody tr");
    if (row instanceof HTMLElement) row.click();
  });
  await sleep(1500);

  const facts = await page.evaluate(() => {
    const tables = [...document.querySelectorAll("table")];
    // The first <svg> on the page is a lucide icon — pick the graph by size instead.
    const svgs = [...document.querySelectorAll("svg")];
    const svg = svgs.sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height)
                                 - (a.getBoundingClientRect().width * a.getBoundingClientRect().height))[0];
    const overflow = [...document.querySelectorAll("*")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
    }).length;
    const txt = document.body.innerText;
    return {
      tables: tables.length,
      nodes: svg ? svg.querySelectorAll("circle").length : 0,
      lines: svg ? svg.querySelectorAll("line").length : 0,
      offscreen: overflow,
      scrollW: document.documentElement.scrollWidth,
      viewW: window.innerWidth,
      hasError: txt.includes("not answering"),
      hasSpikeBanner: txt.includes("Evaluation surface"),
      entitiesShown: /Entities/.test(txt) ? (txt.match(/Entities\s*\n?\s*([\d,]+)/) || [])[1] : null,
      selPanel: txt.includes("Provenance") && txt.includes("Connections"),
      // The TRUE source: elements that stick out AND whose own children do not — a parent that
      // is merely as wide as its overflowing child is a victim, not the cause.
      offenders: [...document.querySelectorAll("*")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ el, r }) => {
          if (r.width <= window.innerWidth + 1) return false;
          const kids = [...el.children].map((c) => c.getBoundingClientRect().width);
          return kids.every((w) => w <= r.width + 1) && Math.max(0, ...kids) <= window.innerWidth + 1;
        })
        .sort((a, b) => b.r.width - a.r.width)
        .slice(0, 8)
        .map(({ el, r }) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} w=${Math.round(r.width)} scrollW=${el.scrollWidth}`),
    };
  });

  await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  report[name] = { ...facts, errors };
  await page.close();
}

await browser.close();
dev.kill();
console.log(JSON.stringify(report, null, 2));
// Vite keeps the event loop alive as a child; without this the script finishes its work and
// then hangs forever, which reads as a failure to whoever ran it.
process.exit(0);