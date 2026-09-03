// Re-verify the 2 flaky checks: answer length (assistant row, not last row) + feedback click.
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await page.type('textarea[placeholder^="Ask about"]', "Password reset steps");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  let len = 0, done = false;
  for (let i = 0; i < 40; i++) {
    len = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".msg-row.assistant .bubble")];
      return (rows[rows.length - 1] || {}).textContent?.trim().length || 0;
    });
    const mid = await page.evaluate(() => { const b = [...document.querySelectorAll("button.btn.helpful")].pop(); return b ? !b.disabled : false; });
    if (len > 60 && mid) { done = true; break; }
    await sleep(2000);
  }
  console.log(`answerLen=${len} buttonsEnabled=${done}`);
  if (done) {
    await page.evaluate(() => [...document.querySelectorAll("button.btn.helpful")].pop()?.click());
    let fb = "";
    for (let i = 0; i < 10 && !fb; i++) { fb = await page.evaluate(() => (document.querySelector(".fb-done") || {}).textContent || ""); if (!fb) await sleep(1000); }
    console.log(`feedback="${fb.trim()}"`);
    console.log(/submitted/i.test(fb) ? "RESULT: ALL PASS" : "RESULT: feedback FAIL");
  } else console.log("RESULT: FAIL (stream/enable)");
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
