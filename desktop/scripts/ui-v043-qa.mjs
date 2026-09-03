// v0.4.3 QA: dialog (sign-out) on mobile dark — matches user's screenshot scenario.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  // phone-ish viewport + dark theme like the user's screenshot
  await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await sleep(400);
  // open the sign-out AlertDialog
  await page.evaluate(() => document.querySelector(".signout-btn")?.click());
  await sleep(900);
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('[data-slot="alert-dialog-content"]');
    if (!d) return null;
    const cs = getComputedStyle(d);
    return { border: cs.borderTopWidth, bg: cs.backgroundColor, radius: cs.borderRadius, shadowParts: cs.boxShadow.split("),").length };
  });
  console.log("dialog:", JSON.stringify(dlg));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v043-dialog-mobile-dark.png" });
  // cancel it
  await page.evaluate(() => { const c = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel"); if (c) c.click(); });
  console.log("OK");
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
