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
  await sleep(1500);
  await page.evaluate(() => { window.location.hash = "#/chat"; });
  await sleep(2500);
  await page.focus("textarea");
  await page.keyboard.type("What should I check if PostgreSQL has connection timeout?", { delay: 5 });
  await page.keyboard.press("Enter");
  // wait up to 90s for the usage badge (appears on done event)
  let badge = "";
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    badge = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll("span"));
      for (const s of spans) {
        const t = (s.textContent || "").trim();
        if (/\d+\s*in\s*·\s*\d+\s*out/.test(t)) return t;
      }
      return "";
    });
    if (badge) break;
  }
  console.log("USAGE BADGE:", badge || "(not found)");
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/usage-badge.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }