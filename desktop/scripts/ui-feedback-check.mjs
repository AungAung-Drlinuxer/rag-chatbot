// Verify inline RAG sources + per-message feedback render in the chat area.
// Run: cd desktop && node scripts/ui-feedback-check.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://127.0.0.1:4173/";
const OUT = "C:/Users/aungaung/it-help-chatbot/docs/ui-feedback-check.png";
mkdirSync(dirname(OUT), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(APP, { waitUntil: "networkidle0", timeout: 20000 });
  await page.waitForSelector('input[placeholder="Username"]', { timeout: 10000 });
  await page.type('input[placeholder="Username"]', "dev");
  await page.type('input[placeholder="Password"]', "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await sleep(600);

  await page.type('textarea[placeholder^="Ask about"]', "Database connection timeout");
  await page.evaluate(() => { const b = [...document.querySelectorAll("button.send")][0]; if (b) b.click(); });

  // Wait for the assistant message to render its inline feedback row (always present for assistant msgs)
  await page.waitForSelector(".msg.assistant .fb-inline", { timeout: 40000 });
  // Give the RAG answer + sources a moment to stream in
  await sleep(4000);

  const hasSources = await page.evaluate(() => !!document.querySelector(".msg.assistant .src-inline"));
  const srcItems = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .src-item")].map((e) => e.textContent.trim()));
  const fbQ = await page.evaluate(() => (document.querySelector(".msg.assistant .fb-q") || {}).textContent);
  const inlineInChat = await page.evaluate(() => {
    const fb = document.querySelector(".msg.assistant .fb-inline");
    const ctx = document.querySelector("aside.context");
    // feedback must live inside a message bubble area (.msg), NOT inside .context aside
    return fb ? !!(fb.closest(".msg")) : false;
  });
  console.log("hasSources=" + hasSources);
  console.log("srcItems=" + JSON.stringify(srcItems));
  console.log("fbQ=" + fbQ);
  console.log("fbInsideMsg(chat area)=" + inlineInChat);
  await page.screenshot({ path: OUT });
  console.log("SHOT " + OUT);
  console.log("RESULT: " + (inlineInChat ? (hasSources ? "PASS" : "PARTIAL(no sources yet)") : "FAIL(feedback in wrong place)"));
} catch (e) {
  console.log("RESULT: FAIL - " + e.message);
} finally {
  await browser.close();
}
