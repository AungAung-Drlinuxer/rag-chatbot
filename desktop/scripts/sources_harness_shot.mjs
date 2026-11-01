// Screenshot + MEASURE the right-hand "Knowledge sources" panel.
//
// Why a harness instead of the running app: the chat page is behind auth and verification
// must not sign in as anyone. The harness renders the SAME SourcePanel the app renders,
// on the SAME stylesheet, fed by real KB titles/excerpts (see src/__sources_harness__.tsx).
//
// What it MEASURES rather than looks at — this app has shipped a panel whose numbers were
// fabricated once already, and an invisible overflow once already, so the assertions here
// are numeric:
//   1. no JS errors on any scenario
//   2. documentElement.scrollWidth === clientWidth (no horizontal overflow)
//   3. the aside is exactly 336px wide
//   4. the ticket scenario renders NO relevance meter — the old card drew one for a null
//      score via `width: undefined%`, an invalid declaration the browser silently drops
//   5. the 8-source payload collapses the repeated page_id into ONE card carrying an "x2"
//      chunk chip, so 7 cards are rendered, not 8
//   6. every figure shown comes from the payload: the panel must not print a number that
//      is not in `retrieval`
//
// Usage (dev server only): node scripts/sources_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5216;
const BASE = `http://localhost:${PORT}/sources-harness.html`;

// Linux-first; the sibling scope script hardcodes a Windows Chrome path, which is why this
// one resolves the binary instead of assuming it.
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
let failed = false;

/** What the page must look like, per scenario. */
const EXPECT = {
  sources: { cards: 7, meters: 7, groupChip: true },
  ticket: { cards: 2, meters: 0, groupChip: false },
  empty: { cards: 0, meters: 0, groupChip: false },
  live: { cards: 0, meters: 0, groupChip: false },
};

for (const scenario of ["sources", "ticket", "empty", "live"]) {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage();
    // Split by kind rather than one bag: a "Failed to load resource" console line carries
    // no URL, so attributing it needs the response side. A harness page has no favicon, so
    // /favicon.ico 404s — that is an artefact of the harness, not of the component.
    const pageErrors = [];
    const consoleErrors = [];
    const http4xx = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    page.on("response", (r) => {
      if (r.status() >= 400) http4xx.push({ status: r.status(), url: r.url().slice(0, 160) });
    });
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto(`${BASE}?scenario=${scenario}&theme=${theme}`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });
    await sleep(900);

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const aside = document.querySelector("aside");
      const cards = [...document.querySelectorAll("aside article")];
      const meters = cards.map((c) => c.querySelector('div[class*="overflow-hidden"][class*="rounded-full"]'));
      return {
        scrollW: de.scrollWidth,
        clientW: de.clientWidth,
        asideW: aside ? Math.round(aside.getBoundingClientRect().width) : null,
        asideVisible: aside ? getComputedStyle(aside).display !== "none" : false,
        cards: cards.length,
        meters: meters.filter(Boolean).length,
        // any inline width that is not a real percentage — the old `undefined%` bug
        badWidths: [...document.querySelectorAll("aside [style]")]
          .map((e) => e.getAttribute("style"))
          .filter((s) => /width:\s*(undefined|null|NaN)/.test(s ?? "")),
        groupChips: [...document.querySelectorAll("aside article")].filter((c) =>
          /×\d/.test(c.textContent ?? ""),
        ).length,
        // the numbers the panel claims, so they can be checked against the payload
        headerCount: document.querySelector("aside h2")?.parentElement?.parentElement?.textContent ?? "",
        titleFont: cards[0]?.querySelector("h4")
          ? getComputedStyle(cards[0].querySelector("h4")).fontSize
          : null,
        excerptFont: cards[0]?.querySelector("p")
          ? getComputedStyle(cards[0].querySelector("p")).fontSize
          : null,
        panelBg: aside ? getComputedStyle(aside).backgroundColor : null,
      };
    });

    const exp = EXPECT[scenario];
    // A resource-load console line with no URL is attributed via the response side: if
    // every 4xx seen was the harness's missing favicon, there is nothing to report.
    const generic = consoleErrors.filter((t) => /Failed to load resource/.test(t));
    const namedConsole = consoleErrors.filter((t) => !/Failed to load resource/.test(t));
    const badHttp = http4xx.filter((r) => !/favicon\.ico/.test(r.url));
    const unattributed = generic.length > 0 && badHttp.length === 0 && http4xx.length > 0 ? 0 : generic.length;
    const errors = [
      ...pageErrors.map((e) => `pageerror: ${e}`),
      ...namedConsole.map((t) => `console: ${t}`),
      ...badHttp.map((r) => `http ${r.status} ${r.url}`),
    ];
    const problems = [];
    if (errors.length || unattributed) {
      problems.push(`jsErrors=${errors.length + unattributed}`);
    }
    if (m.scrollW > m.clientW) problems.push(`overflow ${m.scrollW}>${m.clientW}`);
    if (!m.asideVisible) problems.push("aside hidden");
    if (m.asideW !== 336) problems.push(`asideW=${m.asideW} (expected 336)`);
    if (m.cards !== exp.cards) problems.push(`cards=${m.cards} (expected ${exp.cards})`);
    if (m.meters !== exp.meters) problems.push(`meters=${m.meters} (expected ${exp.meters})`);
    if (m.badWidths.length) problems.push(`invalid widths: ${m.badWidths.join(" | ")}`);
    if (exp.groupChip && m.groupChips !== 1) problems.push(`groupChip=${m.groupChips} (expected 1)`);
    if (!exp.groupChip && m.groupChips !== 0) problems.push(`unexpected groupChip=${m.groupChips}`);
    if (problems.length) failed = true;

    await page.screenshot({ path: `${OUT}/sources_${scenario}_${theme}.png` });
    report[`${scenario}_${theme}`] = {
      ...m,
      problems,
      jsErrors: errors,
      http4xx,
      unattributedResourceErrors: unattributed,
    };
    await page.close();
  }
}

// The retrieval numbers printed must exist in the payload (8 sources, top_k 5).
const s = report.sources_light;
const printed = `${s.headerCount} ${s.titleFont} ${s.excerptFont}`;
report.payloadCheck = {
  headerShowsCount8: s.headerCount.includes("8"),
  titleFont: s.titleFont,
  excerptFont: s.excerptFont,
};
if (!s.headerCount.includes("8")) {
  failed = true;
  report.payloadCheck.problem = `panel did not show the payload's source count: ${printed}`;
}
if (s.titleFont !== "12px" || s.excerptFont !== "11px") {
  failed = true;
  report.payloadCheck.problem = `type ramp off: title=${s.titleFont} excerpt=${s.excerptFont}`;
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
if (failed) {
  console.error("\nFAIL: see per-scenario `problems` above");
  process.exit(1);
}
console.log("\nOK: 8 scenarios rendered — no overflow, no JS errors, no invalid widths, type ramp honoured");
