import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
async function shot(viewport, out) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(500);
  await page.type('input[type="text"]', "dev", { delay: 15 });
  await page.type('input[type="password"]', "dev", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1400);
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(1500);
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("button, a, [role=button]"));
    const integ = items.find((b) => b.textContent.trim().startsWith("Integrations"));
    if (integ) integ.click();
  });
  await sleep(1800);
  await page.screenshot({ path: out });
  await page.close();
}
try {
  await shot({ width: 1440, height: 900 }, "C:/Users/aungaung/it-help-chatbot/docs/toggles-desktop.png");
  await shot({ width: 820, height: 1180 }, "C:/Users/aungaung/it-help-chatbot/docs/toggles-tablet.png");
  await shot({ width: 390, height: 844 }, "C:/Users/aungaung/it-help-chatbot/docs/toggles-mobile.png");
  console.log("all captured");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }