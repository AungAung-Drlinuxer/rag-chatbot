// Prod check: avatars render + layout stable at 2 widths, real answer (OpenRouter).
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await page.type("#u", "dev");
  await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await page.type('textarea[placeholder^="Ask about"]', "VPN keeps disconnecting");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  // wait for answer to stream
  for (let i = 0; i < 30; i++) {
    const len = await page.evaluate(() => (document.querySelector(".msg.assistant .bubble") || {}).textContent?.trim().length || 0);
    if (len > 60) break;
    await sleep(2000);
  }
  const checks = await page.evaluate(() => ({
    aA: !!document.querySelector(".avatar.assistant"),
    aU: !!document.querySelector(".avatar.user"),
    aAText: (document.querySelector(".avatar.assistant") || {}).textContent?.trim(),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    bubbleLen: (document.querySelector(".msg.assistant .bubble") || {}).textContent?.trim().length || 0,
  }));
  console.log(`1366px: assistantAvatar=${checks.aA}(${checks.aAText}) userAvatar=${checks.aU} overflowX=${checks.overflowX} answerLen=${checks.bubbleLen}`);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/prod-avatars-1366.png" });
  await page.setViewport({ width: 900, height: 900 });
  await sleep(900);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  const ctx = await page.evaluate(() => getComputedStyle(document.querySelector(".context") || document.body).display);
  console.log(`900px: overflowX=${ov} contextDisplay=${ctx}`);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/prod-avatars-900.png" });
  console.log((checks.aA && checks.aU && !checks.overflowX && !ov) ? "RESULT: PASS" : "RESULT: FAIL");
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
