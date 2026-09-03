// screenshot login page (local proxy) at multiple sizes
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  for (const [name, w, h] of [["desktop", 1440, 900], ["tablet", 1024, 768], ["mobile", 390, 844]]) {
    await page.setViewport({ width: w, height: h });
    await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
    await sleep(600);
    await page.screenshot({ path: `C:/Users/aungaung/it-help-chatbot/docs/login-${name}.png` });
  }
  console.log("captured");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }