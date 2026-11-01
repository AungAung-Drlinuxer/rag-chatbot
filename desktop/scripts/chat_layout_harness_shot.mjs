// Measure the chat layout the design review is about.
//
// The chat page is behind auth, so it cannot be photographed by signing in. This drives the
// harness (src/__chat_layout_harness__.tsx), which renders the REAL ChatPage with `fetch`
// stubbed, and reports what the DOM actually resolves to. Every claim in the review that can
// be checked arithmetically is checked here:
//
//   "give the conversation a consistent maximum width"  -> messages and composer must MATCH
//   "chat messages are too small"                       -> computed font-size of the answer
//   "use a proper response container"                   -> the answer must not be a bordered box
//   "the RAG pipeline card dominates the conversation"  -> its collapsed height vs expanded
//
// Usage (dev server only): node scripts/chat_layout_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5225;
const BASE = `http://localhost:${PORT}/chat-layout-harness.html`;

const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true, stdio: "pipe", cwd: process.cwd(),
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

async function reachable(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}
let up = false;
for (let i = 0; i < 60 && !up; i++) { up = await reachable(BASE); if (!up) await sleep(1000); }
if (!up) { dev.kill(); throw new Error(`harness not reachable at ${BASE}`); }
await sleep(2500);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const report = { problems: [], themes: {} };
// Format only — call sites push the result, so pushing here would double-count.
const fail = (m) => m;

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
// Attribute resource failures from the RESPONSE side; a harness page has no favicon and its
// 404 carries no URL in the console message, so the message alone cannot be classified.
const http4xx = [];
const unattributed = [];
page.on("response", (r) => { if (r.status() >= 400) http4xx.push(`${r.status()} ${r.url()}`); });
page.on("console", (m) => {
  if (m.type() !== "error") return;
  if (/favicon/i.test(m.text())) return;
  unattributed.push(m.text());
});

const COLUMN = 900;        // the single conversation width, messages and composer
const ANSWER_PX = 13.5;    // was 12px (`text-xs`)

for (const theme of ["light", "dark"]) {
  await page.goto(`${BASE}?theme=${theme}`, { waitUntil: "networkidle2" });
  await page.waitForFunction("() => !!window.__CHAT_HARNESS__", { timeout: 30000 });
  await sleep(1200);

  const opened = await page.evaluate("window.__CHAT_HARNESS__.openConversation()");
  if (!opened) {
    report.problems.push(fail(`[${theme}] the seeded conversation never rendered its messages`));
    continue;
  }
  await sleep(900);

  const m = await page.evaluate("window.__CHAT_HARNESS__.measure()");
  const ov = await page.evaluate("window.__CHAT_HARNESS__.overflow()");

  // --- 1. one conversation width, shared by the messages and the composer -----------
  if (!m.column || Math.abs(m.column.w - COLUMN) > 1) {
    report.problems.push(fail(`[${theme}] message column is ${m.column?.w}px, expected ${COLUMN}px`));
  }
  // The composer is the form's wrapper; it must be the SAME width, which is what the
  // review means by "consistent maximum width" — it was 860 against the messages' 1000.
  const composerInner = await page.evaluate(() => {
    const form = document.querySelector("form");
    const wrap = form?.parentElement;
    return wrap ? Math.round(wrap.getBoundingClientRect().width) : null;
  });
  if (composerInner == null) {
    report.problems.push(fail(`[${theme}] composer wrapper not found`));
  } else if (Math.abs(composerInner - COLUMN) > 1) {
    report.problems.push(fail(`[${theme}] composer is ${composerInner}px but the messages are ${m.column?.w}px — widths must match`));
  }

  // --- 2. the answer is readable, not 12px ------------------------------------------
  if (!m.answer) {
    report.problems.push(fail(`[${theme}] answer container not found (no text-[13.5px] node)`));
  } else {
    const fs = parseFloat(m.answer.fontSize);
    if (Math.abs(fs - ANSWER_PX) > 0.1) {
      report.problems.push(fail(`[${theme}] answer font-size is ${m.answer.fontSize}, expected ${ANSWER_PX}px`));
    }
    const lh = parseFloat(m.answer.lineHeight);
    if (!(lh >= fs * 1.5)) {
      report.problems.push(fail(`[${theme}] answer line-height ${m.answer.lineHeight} is under 1.5x the font size (${fs}px)`));
    }
  }

  // --- 3. the answer is a prose container, not a bordered box ------------------------
  if (m.answer) {
    if (m.answer.borderWidth !== "0px") {
      report.problems.push(fail(`[${theme}] answer still has a ${m.answer.borderWidth} border — it should be plain prose`));
    }
    const bg = m.answer.background;
    const transparent = bg === "rgba(0, 0, 0, 0)" || bg === "transparent";
    if (!transparent) {
      report.problems.push(fail(`[${theme}] answer still paints its own background (${bg})`));
    }
    if (m.answer.shadow !== "none") {
      report.problems.push(fail(`[${theme}] answer still carries a box-shadow`));
    }
  }

  // --- 4. the answer is wider than the user's bubble ---------------------------------
  if (m.answer && m.userBubble) {
    if (!(m.answer.w > m.userBubble.w)) {
      report.problems.push(fail(`[${theme}] answer (${m.answer.w}px) is not wider than the user bubble (${m.userBubble.w}px)`));
    }
  }
  // ...and the user turn is still a bubble, so the change did not flatten both turns.
  if (m.userBubble) {
    if (m.userBubble.borderRadius === "0px") {
      report.problems.push(fail(`[${theme}] user turn lost its bubble radius`));
    }
  }

  // --- 5. the pipeline must not dominate --------------------------------------------
  await page.evaluate("window.__CHAT_HARNESS__.pipeline(true, false)");
  await sleep(600);
  const collapsed = await page.evaluate("window.__CHAT_HARNESS__.pipelineBox()");
  await page.evaluate("window.__CHAT_HARNESS__.pipeline(true, true)");
  await sleep(600);
  const expanded = await page.evaluate("window.__CHAT_HARNESS__.pipelineBox()");

  if (!collapsed || !expanded) {
    report.problems.push(fail(`[${theme}] pipeline did not render in the harness mount point`));
  } else {
    if (!(expanded.h > collapsed.h)) {
      report.problems.push(fail(`[${theme}] pipeline expanded height (${expanded.h}) is not greater than collapsed (${collapsed.h}) — the toggle does nothing`));
    }
    // While answering, the tracker must stay a strip rather than a panel. 220px is a
    // generous ceiling: the old always-open panel ran to several hundred.
    if (collapsed.h > 220) {
      report.problems.push(fail(`[${theme}] collapsed pipeline is ${collapsed.h}px tall — still dominating the answer`));
    }
  }

  if (ov.scrollW !== ov.clientW) {
    report.problems.push(fail(`[${theme}] horizontal overflow: ${ov.scrollW} vs ${ov.clientW}`));
  }

  report.themes[theme] = { ...m, composerInner, pipelineCollapsed: collapsed, pipelineExpanded: expanded };

  await page.screenshot({ path: `${OUT}/chat_layout_${theme}.png`, fullPage: false });
}

report.jsErrors = jsErrors;
report.http4xx = http4xx;
report.unattributedResourceErrors = unattributed;

await browser.close();
dev.kill();

console.log(JSON.stringify(report, null, 2));
if (report.problems.length) {
  console.log(`\nFAILED (${report.problems.length}):`);
  for (const p of report.problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("\nOK: conversation width consistent, answer readable and unboxed, pipeline collapsed while active.");
