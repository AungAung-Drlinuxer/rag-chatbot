import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(600);
  await page.type('input[type="text"]', "dev", { delay: 20 });
  await page.type('input[type="password"]', "dev", { delay: 20 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1500);
  await page.evaluate(() => { window.location.hash = "#/chat"; });
  await sleep(2000);
  // press Ctrl+K
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  await sleep(800);
  const paletteVisible = await page.evaluate(() => document.body.innerText.includes("Search conversations"));
  console.log("palette opened by Ctrl+K:", paletteVisible);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/ctrlk-palette.png" });
  // type to filter
  await page.keyboard.type("postgres");
  await sleep(600);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/ctrlk-filtered.png" });
  // Enter to open first match
  await page.keyboard.press("Enter");
  await sleep(1500);
  const paletteClosed = await page.evaluate(() => !document.querySelector(".fixed.inset-0.z-\[100\]"));
  console.log("palette closed after Enter:", paletteClosed);
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }