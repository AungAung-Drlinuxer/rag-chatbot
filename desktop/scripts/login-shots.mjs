// Screenshot the new login screen (light + dark) for visual review.
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
  await sleep(700);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/redesign-login-light.png" });
  // dark mode preview
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await sleep(400);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/redesign-login-dark.png" });
  console.log("SHOTS_OK");
} catch (e) {
  console.log("FAIL " + e.message);
} finally { await browser.close(); }
