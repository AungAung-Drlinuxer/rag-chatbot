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
  await sleep(2500);
  const opened = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".group.relative"));
    if (!items.length) return "no items";
    const item = items[0];
    item.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    const dots = item.querySelector("[role=button]");
    if (!dots) return "no dots button";
    dots.click();
    return "clicked dots";
  });
  console.log("dots menu:", opened);
  await sleep(800);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/conv-menu.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }