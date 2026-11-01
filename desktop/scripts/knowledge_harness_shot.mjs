// Screenshot the Knowledge Base page (light + dark) from the render harness.
//
// CAPTURE-ONLY on purpose. An assertion-based harness fails early and leaves NO image,
// which is exactly what happened to the chat-layout harness — it reported FAILED and
// produced nothing to look at. The numbers that matter for this page (token values, the
// absence of the old gradient, column count) are checked in code separately; this script's
// job is to always leave a picture behind.
//
// Usage (dev server only): node scripts/knowledge_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5229; // 5217/5219/5221/5223/5225/5227 are taken by the other harnesses
const BASE = `http://localhost:${PORT}/knowledge-harness.html`;

const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true,
  stdio: "pipe",
  cwd: process.cwd(),
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  up = await reachable(BASE);
  if (!up) await sleep(1000);
}
if (!up) {
  dev.kill();
  throw new Error(`harness server not reachable at ${BASE}`);
}
await sleep(2500);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const report = {};

try {
  for (const [theme, scenario] of [["light", "list"], ["dark", "list"], ["light", "error"]]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    // Wide enough for the real table (min-w-[860px]) plus the page gutters, and tall
    // enough that the full page is captured without stitching.
    await page.setViewport({ width: 1440, height: 1400, deviceScaleFactor: 2 });
    await page.goto(`${BASE}?theme=${theme}&scenario=${scenario}`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => window.__KB_HARNESS__?.ready === true, { timeout: 20000 });
    await sleep(1200);

    // Measure what the redesign claims, from COMPUTED values rather than the source.
    const measured = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const root = document.querySelector("main");
      const table = document.querySelector("table");
      const headers = [...document.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
      const gradientPanels = [...document.querySelectorAll("section")].filter((s) =>
        getComputedStyle(s).backgroundImage.includes("gradient"),
      ).length;
      return {
        theme: document.documentElement.getAttribute("data-theme"),
        background: cs.getPropertyValue("--background").trim(),
        primary: cs.getPropertyValue("--primary").trim(),
        card: cs.getPropertyValue("--card").trim(),
        mutedForeground: cs.getPropertyValue("--muted-foreground").trim(),
        accentSoft: cs.getPropertyValue("--accent-soft").trim(),
        gradientPanels,
        columns: headers.length,
        headers,
        rowCount: document.querySelectorAll("tbody tr").length,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        hasMain: !!root,
        tableFound: !!table,
        // The duplicate-title bug: "Knowledge Base Articles" must appear once (the
        // PageHeader), not twice.
        kbTitleCount: (document.body.innerText.match(/Knowledge Base Articles/g) ?? []).length,
        apiCalls: window.__KB_HARNESS__?.calls?.length ?? 0,
      };
    });

    const file = `${OUT}/knowledge_${scenario}_${theme}.png`;
    await page.screenshot({ path: file, fullPage: true });
    report[`${scenario}_${theme}`] = { file, errors, ...measured };
    await page.close();
  }
} finally {
  await browser.close();
  dev.kill();
}

console.log(JSON.stringify(report, null, 2));
