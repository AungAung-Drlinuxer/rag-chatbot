// Debug: what does the page actually show?
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 150)); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(2000);
  const body = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log("BODY:", JSON.stringify(body));
  const hasLogin = await page.evaluate(() => !!document.querySelector("#login-username"));
  console.log("login form:", hasLogin);
} catch (e) {
  console.log("FAIL", e.message);
} finally {
  await browser.close();
}