// Verify inline RAG sources + per-message feedback on the PROD cluster (chat.drlinuxer.com).
// Run: cd desktop && node scripts/ui-feedback-prod.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "https://chat.drlinuxer.com/";
const OUT = "C:/Users/aungaung/it-help-chatbot/docs/ui-feedback-prod.png";
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

  await page.waitForSelector(".msg.assistant .fb-inline", { timeout: 60000 });
  // poll for RAG sources (hits arrive in the meta event; LLM answer may still be streaming)
  let hasSources = false;
  for (let t = 0; t < 15; t++) {
    hasSources = await page.evaluate(() => !!document.querySelector(".msg.assistant .src-inline"));
    if (hasSources) break;
    await sleep(2000);
  }
  const srcItems = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .src-item")].map((e) => e.textContent.trim()));
  const fbInMsg = await page.evaluate(() => { const fb = document.querySelector(".msg.assistant .fb-inline"); return fb ? !!fb.closest(".msg") : false; });
  const answer = await page.evaluate(() => (document.querySelector(".msg.assistant .bubble .md") || {}).textContent?.slice(0, 80));
  console.log("hasSources=" + hasSources);
  console.log("srcItems=" + JSON.stringify(srcItems));
  console.log("fbInMsg(chat area)=" + fbInMsg);
  console.log("answerHead=" + (answer || "(streaming/empty)"));
  await page.screenshot({ path: OUT });
  console.log("SHOT " + OUT);
  console.log("RESULT: " + ((hasSources && fbInMsg) ? "PASS" : "CHECKKIND"));
} catch (e) {
  console.log("RESULT: FAIL - " + e.message);
} finally {
  await browser.close();
}
