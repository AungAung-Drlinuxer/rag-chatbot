// Screenshot the integration diagram
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.goto("file:///C:/Users/aungaung/it-help-chatbot/docs/keycloak-theme-integration.html", { waitUntil: "networkidle0" });
  await sleep(300);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/kc-integration-diagram.png", fullPage: true });
  console.log("diagram captured");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }