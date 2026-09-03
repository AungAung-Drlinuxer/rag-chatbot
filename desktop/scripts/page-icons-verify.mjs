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
  await sleep(500);
  await page.type('input[type="text"]', "ith@dmin", { delay: 15 });
  await page.type('input[type="password"]', "Pwint@160320", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(2000);
  const pages = ["#/dashboard", "#/tickets", "#/users", "#/articles", "#/settings"];
  const results = {};
  for (const p of pages) {
    await page.evaluate((h) => { window.location.hash = h; }, p);
    await sleep(2500);
    results[p] = await page.evaluate(() => {
      // page icon chip = div with bg-[#0A1628] inside header
      const chip = document.querySelector("header div.rounded-2xl");
      const h1 = document.querySelector("h1");
      return {
        iconChip: !!chip,
        chipColor: chip ? getComputedStyle(chip).backgroundColor : null,
        title: h1 ? h1.textContent.trim() : null,
      };
    });
  }
  console.log(JSON.stringify(results, null, 1));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/page-icons.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }