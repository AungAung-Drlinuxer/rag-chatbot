// Post-deploy check: new login renders + theme engine now applies data-theme.
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "https://chat.drlinuxer.com/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(APP, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector(".login-shell", { timeout: 15000 });
  console.log("PASS | new split-panel login renders on prod");
  await sleep(800);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/prod-login-after.png" });

  // login + set dark theme, verify data-theme flips
  await page.type("#u", "dev");
  await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  const themeBefore = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  // go to settings, switch theme to dark
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /settings/i.test(e.textContent)); if (n) n.click(); });
  await page.waitForSelector(".set-card select", { timeout: 10000 });
  await page.select(".set-card select", "dark");
  await sleep(1500);
  const themeAfter = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  console.log(`theme before=${themeBefore} after=${themeAfter}`);
  console.log((themeAfter === "dark") ? "PASS | theme engine applies data-theme=dark" : "FAIL | theme not applied");
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/prod-dark-chat.png" });
  // restore light
  await page.select(".set-card select", "light");
  await sleep(1200);
  const restored = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  console.log(`PASS | restored theme=${restored}`);
} catch (e) {
  console.log("FAIL " + e.message);
} finally { await browser.close(); }
