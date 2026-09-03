// v0.3.0 visual QA: login + chat (light/dark) + settings screenshots.
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://127.0.0.1:4173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(APP, { waitUntil: "networkidle0", timeout: 20000 });
  await page.waitForSelector(".login-shell", { timeout: 10000 });
  await sleep(500);
  console.log("login renders:", !!(await page.$(".login-shell")));
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  // chat with a question
  await page.type('textarea[placeholder^="Ask about"]', "Database connection timeout");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  // capture typing dots early
  await sleep(600);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v030-chat-typing.png" });
  for (let i = 0; i < 20; i++) {
    const len = await page.evaluate(() => (document.querySelector(".msg.assistant .bubble") || {}).textContent?.trim().length || 0);
    if (len > 40) break;
    await sleep(1000);
  }
  await sleep(1500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v030-chat-light.png" });
  // dark mode via API-backed pref
  await page.evaluate(async () => {
    const t = JSON.parse(sessionStorage.getItem("tokens") || "{}");
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.access}` }, body: JSON.stringify({ theme: "dark" }) });
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await sleep(500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v030-chat-dark.png" });
  // settings in dark
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /settings/i.test(e.textContent)); if (n) n.click(); });
  await page.waitForFunction(() => document.querySelectorAll(".set-card, [data-slot=card]").length >= 6, { timeout: 10000 }).catch(() => {});
  await sleep(800);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v030-settings-dark.png" });
  // reset theme
  await page.evaluate(async () => { const t = JSON.parse(sessionStorage.getItem("tokens") || "{}"); await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.access}` }, body: JSON.stringify({ theme: "system" }) }); });
  console.log("SHOTS_DONE");
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
