// Screenshot the Keycloak theme preview at desktop + mobile sizes
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  const url = "file:///C:/Users/aungaung/it-help-chatbot/keycloak/theme-preview.html";
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "networkidle0" });
  await sleep(300);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/kc-theme-desktop.png" });
  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/kc-theme-mobile.png" });
  console.log("captured desktop + mobile");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }