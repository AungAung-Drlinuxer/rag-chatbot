// Frontend login smoke test — headless Chrome (no approval popup).
// Run: cd desktop && node scripts/login-screenshot.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://127.0.0.1:4173/";
const OUT = "C:/Users/aungaung/it-help-chatbot/docs";
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 820 });
const logs = [];
page.on("console", (m) => logs.push(m.text()));
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));

try {
  await page.goto(APP, { waitUntil: "networkidle0", timeout: 20000 });
  await page.waitForSelector('input[placeholder="Username"]', { timeout: 10000 });
  console.log("STEP1: login form visible (title=" + (await page.title()) + ")");

  // Login dev / dev
  await page.type('input[placeholder="Username"]', "dev");
  await page.type('input[placeholder="Password"]', "dev");
  await page.keyboard.press("Enter");

  // Login success -> main app (.sidebar) appears
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await sleep(800);
  const roleBadge = await page.evaluate(() => (document.body.innerText.match(/IT Engineer[^\n]*/) || ["none"])[0]);
  console.log("STEP2: LOGIN SUCCESS - main app visible, role=" + roleBadge);
  await page.screenshot({ path: OUT + "/login-success.png" });
  console.log("SHOT_LOGIN_SUCCESS");

  // Ask a question (live SSE)
  await page.type('textarea[placeholder*="Ask about"]', "Database connection is timing out");
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith("Send")); if (b) b.click(); });
  await sleep(6000);
  const chatText = await page.evaluate(() => ((document.querySelector(".chat-scroll") || {}).innerText || "").replace(/\s+/g, " ").slice(0, 220));
  console.log("CHAT_TEXT: " + chatText);
  await page.screenshot({ path: OUT + "/login-chat.png" });
  console.log("SHOT_LOGIN_CHAT");
  console.log("RESULT: PASS");
} catch (e) {
  console.log("RESULT: FAIL - " + e.message);
  await page.screenshot({ path: OUT + "/login-fail.png" }).catch(() => {});
} finally {
  console.log("CONSOLE_TAIL: " + logs.slice(-6).join(" | "));
  await browser.close();
}
