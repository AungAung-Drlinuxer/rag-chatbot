import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0" });
await page.waitForSelector("#login-username");
await page.type("#login-username", process.env.VERIFY_USER);
await page.type("#login-password", process.env.VERIFY_PASS);
await page.keyboard.press("Enter");
await sleep(4000);
await page.evaluate(() => { [...document.querySelectorAll("button")].find(x=>/^tickets$/i.test((x.textContent||"").trim()))?.click(); });
await sleep(6000);
  const nav2 = await page.evaluate(() => {
    const state = { url: location.hash, h1: document.querySelector("h1")?.textContent?.trim() };
    return state;
  });
  console.log("after nav:", JSON.stringify(nav2));
const r = await page.evaluate(() => {
  const ths = [...document.querySelectorAll("th")].map(t => (t.textContent||"").trim());
  const firstCell = document.querySelector("tbody tr td")?.textContent?.trim();
  const rowButton = document.querySelector("tbody tr td button")?.textContent?.trim();
  return { ths, firstCell: firstCell?.slice(0,30), rowButton };
});
console.log(JSON.stringify(r));
await browser.close();
