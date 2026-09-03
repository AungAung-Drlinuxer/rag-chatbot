import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
const sizes = [
  ["desktop", 1440, 900],
  ["laptop", 1280, 720],
  ["tablet", 820, 1180],
  ["mobile", 390, 844],
];
try {
  for (const [name, w, h] of sizes) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
    await sleep(1000);
    await page.screenshot({ path: `C:/Users/aungaung/it-help-chatbot/docs/login-resp-${name}.png` });
    await page.close();
  }
  console.log("all captured");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }