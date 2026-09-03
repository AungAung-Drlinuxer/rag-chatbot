// Verify the "Feedback submitted ✓" confirmation + button disable on PROD.
// Run: cd desktop && node scripts/ui-feedback-confirm-prod.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "https://chat.drlinuxer.com/";
const OUT = "C:/Users/aungaung/it-help-chatbot/docs/ui-feedback-confirm-prod.png";
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

  // Wait until the Helpful button is ENABLED (messageId set on the 'done' event = answer finished)
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll(".msg.assistant button.btn.helpful")].pop();
    return b && !b.disabled;
  }, { timeout: 120000 });

  // Click Helpful on the last assistant message
  await page.evaluate(() => { const b = [...document.querySelectorAll(".msg.assistant button.btn.helpful")].pop(); if (b) b.click(); });

  // Wait for the confirmation to appear
  await page.waitForSelector(".msg.assistant .fb-done", { timeout: 15000 });
  const doneText = await page.evaluate(() => (document.querySelector(".msg.assistant .fb-done") || {}).textContent);
  const helpfulDisabled = await page.evaluate(() => { const b = [...document.querySelectorAll(".msg.assistant button.btn.helpful")].pop(); return b ? b.disabled : null; });
  console.log("doneText=" + doneText);
  console.log("helpfulDisabledAfterSubmit=" + helpfulDisabled);
  await page.screenshot({ path: OUT });
  console.log("SHOT " + OUT);
  console.log("RESULT: " + (/Feedback submitted/i.test(doneText || "") ? "PASS" : "FAIL"));
} catch (e) {
  console.log("RESULT: FAIL - " + e.message);
} finally {
  await browser.close();
}
