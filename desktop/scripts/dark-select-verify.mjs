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
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(2000);
  await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "dark"); });
  await sleep(400);
  const tzBox = await page.evaluate(() => {
    const sel = Array.from(document.querySelectorAll("select")).find((s) => s.value && s.value.startsWith("Asia/"));
    if (!sel) return null;
    sel.scrollIntoView({ block: "center" });
    const r = sel.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  console.log("tz box:", JSON.stringify(tzBox));
  if (tzBox) { await page.mouse.click(tzBox.x, tzBox.y); await sleep(800); }
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/dark-select.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }