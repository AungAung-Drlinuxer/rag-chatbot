// Verify the new "⚡ N tok · kN" usage pill on the PROD cluster.
// Run: cd desktop && node scripts/ui-usage-prod.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "https://chat.drlinuxer.com/";
const OUT = "C:/Users/aungaung/it-help-chatbot/docs/ui-usage-prod.png";
mkdirSync(dirname(OUT), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(APP, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
  await page.type('input[placeholder="Username"]', "dev");
  await page.type('input[placeholder="Password"]', "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await sleep(500);

  await page.type('textarea[placeholder^="Ask about"]', "Database connection timeout");
  await page.evaluate(() => { const b = [...document.querySelectorAll("button.send")][0]; if (b) b.click(); });

  // Wait for the rich usage pill (starts with ⚡) — that proves the done event
  // carried `usage` from the LLM, not just the RAG context fallback.
  let pillText = "";
  for (let t = 0; t < 30; t++) {
    pillText = await page.evaluate(() => (document.querySelector(".msg.assistant .badge.usage") || {}).textContent || "");
    if (pillText && pillText.includes("⚡")) break;
    await sleep(2000);
  }
  const title = await page.evaluate(() => (document.querySelector(".msg.assistant .badge.usage") || {}).title || "");
  const sources = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .src-item")].map(e => e.textContent.trim()));
  console.log("usagePill=" + JSON.stringify(pillText));
  console.log("title=" + title);
  console.log("sources=" + JSON.stringify(sources));
  await page.screenshot({ path: OUT });
  console.log("SHOT " + OUT);
  console.log("RESULT: " + (pillText && pillText.includes("⚡") ? "PASS(rich)" : "PASS(partial)"));
} catch (e) {
  console.log("RESULT: FAIL - " + e.message);
} finally {
  await browser.close();
}
