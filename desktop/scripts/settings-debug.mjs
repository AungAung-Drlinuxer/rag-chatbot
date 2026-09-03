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
  await sleep(2500);
  // dump visible nav labels
  const labels = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button, a, [role=button], .navitem"));
    return els.map((e) => e.textContent.trim()).filter((t) => t && t.length < 40).slice(0, 40);
  });
  console.log("labels:", JSON.stringify(labels));
  const hasHttps = await page.evaluate(() => document.body.innerText.includes("Require HTTPS"));
  console.log("'Require HTTPS' visible:", hasHttps);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/settings-debug.png" });
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }