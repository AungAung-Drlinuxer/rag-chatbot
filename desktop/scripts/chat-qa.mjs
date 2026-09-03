// Chat page QA — new full-screen chat renders + streaming works
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#login-username", "dev");
  await page.type("#login-password", "dev");
  await page.keyboard.press("Enter");
  await sleep(1500);
  const chatVisible = await page.evaluate(() => !!document.querySelector("textarea[placeholder='Ask an IT question...']"));
  console.log("new chat page visible:", chatVisible);
  // history list loaded?
  const convos = await page.evaluate(() => document.body.innerText.includes("Recent conversations"));
  console.log("history sidebar:", convos);
  // send a message
  await page.type("textarea[placeholder='Ask an IT question...']", "PostgreSQL connection timeout");
  await page.keyboard.press("Enter");
  let gotTokens = false;
  for (let i = 0; i < 24; i++) {
    await sleep(1500);
    const len = await page.evaluate(() => document.body.innerText.length);
    const hasMeta = await page.evaluate(() =>
      document.body.innerText.includes("confidence") || document.body.innerText.includes("Sources"));
    if (hasMeta) { gotTokens = true; break; }
  }
  console.log("stream response received:", gotTokens);
  console.log("ERRORS:", errors.slice(0, 4));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/chat-v013.png" });
} catch (e) {
  console.log("FAIL", e.message);
} finally {
  await browser.close();
}