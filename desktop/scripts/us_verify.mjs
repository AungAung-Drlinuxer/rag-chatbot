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
await page.goto("https://chat.drlinuxer.com/#/users", { waitUntil: "networkidle2", timeout: 45000 });
await sleep(5000);
const texts = await page.evaluate(() => {
  const body = document.body.innerText;
  return {
    neverLogin: (body.match(/Never logged in/g) || []).length,
    noDept: (body.match(/No department/g) || []).length,
    adSync: (body.match(/AD sync/g) || []).length,
    system: (body.match(/SYSTEM/g) || []).length,
    bundle: [...document.scripts].map(s => s.src).find(s => s.includes("index-")) || "",
  };
});
console.log(JSON.stringify(texts, null, 1));
await browser.close();
