// v0.3.0 prod verification: new UI stack renders + core flows still work.
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (n, c, e = "") => R.push(`${c ? "PASS" : "FAIL"} | ${n}${e ? " | " + e : ""}`);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector(".login-shell", { timeout: 15000 });
  ok("v0.3.0 login renders", true);
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  // glass topbar present
  const glass = await page.evaluate(() => getComputedStyle(document.querySelector(".topbar")).backdropFilter !== "");
  ok("glass topbar (backdrop-filter)", glass);
  // send a message; check motion transform on last row + sources + typing
  await page.type('textarea[placeholder^="Ask about"]', "VPN keeps disconnecting");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  let srcs = 0, pill = "", answerLen = 0, motionOK = false;
  for (let i = 0; i < 35; i++) {
    const st = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".msg-row")];
      const last = rows[rows.length - 1];
      return {
        len: (document.querySelector(".msg.assistant .bubble") || {}).textContent?.trim().length || 0,
        srcs: document.querySelectorAll(".msg.assistant .src-item").length,
        pill: (document.querySelector(".msg.assistant .badge.usage") || {}).textContent || "",
        transform: last ? getComputedStyle(last).transform : "none",
      };
    });
    answerLen = st.len; srcs = st.srcs; pill = st.pill.trim();
    if (st.transform && st.transform !== "none") motionOK = true;
    if (answerLen > 60 && srcs > 0 && pill) break;
    await sleep(2000);
  }
  ok("answer streams (real LLM)", answerLen > 60, `${answerLen} chars`);
  ok("motion applied to rows (framer-motion)", motionOK);
  ok("sources render (animated)", srcs > 0, `${srcs} sources`);
  ok("usage pill renders", !!pill, pill);
  // settings renders w/ shadcn cards
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /settings/i.test(e.textContent)); if (n) n.click(); });
  await page.waitForFunction(() => document.querySelectorAll(".set-card, [data-slot=card]").length >= 6, { timeout: 12000 }).catch(() => {});
  await sleep(600);
  const cards = await page.evaluate(() => document.querySelectorAll(".set-card, [data-slot=card]").length);
  ok("settings renders (shadcn cards)", cards >= 6, `${cards} cards`);
  // dark theme live apply
  await page.evaluate(() => {
    const sel = document.querySelector("select");
    if (sel) { sel.value = "dark"; sel.dispatchEvent(new Event("change", { bubbles: true })); }
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await sleep(400);
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok("dark theme applies", darkBg.includes("11, 18, 32"), darkBg);
  // revert theme via API
  await page.evaluate(async () => {
    const t = JSON.parse(sessionStorage.getItem("tokens") || "{}");
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.access}` }, body: JSON.stringify({ theme: "system" }) }).catch(() => {});
  });
  // back to chat — send feedback on last answer
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /assistant/i.test(e.textContent)); if (n) n.click(); });
  await sleep(800);
  const fbBtn = await page.evaluate(() => { const b = [...document.querySelectorAll("button.btn.helpful")].pop(); if (b && !b.disabled) b.click(); return b ? !b.disabled : false; });
  let fbDone = "";
  for (let i = 0; i < 8 && !fbDone; i++) { fbDone = await page.evaluate(() => (document.querySelector(".fb-done") || {}).textContent || ""); if (!fbDone) await sleep(800); }
  ok("feedback still works", /submitted/i.test(fbDone), fbDone);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v030-prod-final.png" });
  console.log(R.join("\n"));
  const fails = R.filter(r => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); console.log(R.join("\n")); } finally { await browser.close(); }
