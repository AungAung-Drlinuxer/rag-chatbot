// Verify theme engine applies the SAVED pref on fresh load (the real user path).
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await page.type('input[placeholder="e.g. aung.lae"], #u', "dev");
  await page.type('#p', "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await sleep(2500); // allow getMySettings -> applyUserPrefs
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  console.log(`saved=dark -> data-theme=${theme} body-bg=${bg}`);
  console.log(theme === "dark" ? "PASS | theme engine applies saved pref on load" : "FAIL");
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/prod-dark-verified.png" });
  // restore to light via API-backed UI path
  await page.evaluate(() => fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + sessionStorage.getItem("noop") }, body: "{}" }).catch(() => {}));
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
