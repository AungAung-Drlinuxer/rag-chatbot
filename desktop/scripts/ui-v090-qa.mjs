// v0.9.0 chat UI QA: timestamps + quick replies.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (n, c, e = "") => { R.push((c ? "PASS" : "FAIL") + " | " + n + (e ? " | " + e : "")); console.log(R[R.length-1]); };
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  const qr = await page.evaluate(() => {
    const el = document.querySelector(".quick-replies");
    const chips = [...(el?.querySelectorAll(".qr-chip") ?? [])].map((c) => c.textContent.trim());
    return { present: !!el, count: chips.length, first: chips[0] };
  });
  ok("4 quick replies visible", qr.present && qr.count === 4, JSON.stringify(qr));
  await page.evaluate(() => document.querySelector(".qr-chip")?.click());
  let hasAnswer = false;
  for (let i = 0; i < 20; i++) {
    const len = await page.evaluate(() => ([...document.querySelectorAll(".msg-row.assistant .bubble")].pop() || {}).textContent?.length || 0);
    if (len > 30) { hasAnswer = true; break; }
    await sleep(1500);
  }
  ok("quick reply triggers send", hasAnswer);
  await sleep(500);
  const ts = await page.evaluate(() => {
    const u = document.querySelector(".msg-time.user")?.textContent.trim();
    const a = document.querySelector(".msg-time.assistant")?.textContent.trim();
    const has = (s) => /\d{1,2}:\d{2}/.test(s || "");
    return { userTime: u, asstTime: a, userOk: has(u), asstOk: has(a) };
  });
  ok("timestamps render HH:MM (user+asst)", ts.userOk && ts.asstOk, JSON.stringify(ts));
  const qrGone = await page.evaluate(() => !!document.querySelector(".quick-replies"));
  ok("quick replies hide after first message", !qrGone);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v090-chat.png" });
  const fails = R.filter(r => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
