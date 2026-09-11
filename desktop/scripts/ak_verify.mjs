import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--no-sandbox", "--disk-cache-size=1", "--disable-application-cache"]
});
const page = await browser.newPage();
await page.setCacheEnabled(false);
await page.setViewport({ width: 1600, height: 900 });
await page.goto("https://chat.drlinuxer.com/#/login", { waitUntil: "networkidle2", timeout: 45000 });
await sleep(1500);
await page.type('input[name="username"]', "ui-reviewer");
await page.type('input[name="password"]', "UiReview!x7");
await page.click('button[type="submit"]');
await sleep(6000);
await page.goto("https://chat.drlinuxer.com/#/apikeys", { waitUntil: "networkidle2", timeout: 45000 });
await sleep(5000);
const r = await page.evaluate(() => {
  const b = document.body.innerText;
  return {
    activeBadge: (b.match(/active/gi) || []).length,
    neverUsed: (b.match(/never used/g) || []).length,
    allTab: b.includes("All") && b.includes("Active") && b.includes("Revoked"),
    system: (b.match(/All keys/g) || []).length,
  };
});
console.log(JSON.stringify(r));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/ak_verify.png" });
await browser.close();
