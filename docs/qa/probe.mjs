import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 150)));
page.on("requestfailed", (r) => errs.push("REQFAIL " + r.url().slice(0, 90) + " " + r.failure()?.errorText));
await page.setViewport({ width: 1360, height: 900 });
await page.goto("http://localhost:1420/", { waitUntil: "networkidle0", timeout: 30000 });
const u = await page.waitForSelector("#login-username", { timeout: 15000 });
await u.type(process.env.VERIFY_USER);
await page.waitForSelector("#login-password").then((p) => p.type(process.env.VERIFY_PASS));
await page.keyboard.press("Enter");
await sleep(6000);
console.log("url:", page.url());
console.log("body200:", (await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n+/g, " | "));
console.log("errs:", errs.slice(0, 6));
await page.screenshot({ path: "D:/ragchatbot/verify_probe.png" });
await browser.close();
