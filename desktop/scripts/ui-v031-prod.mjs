// v0.3.1 prod check: dropdown menu, AlertDialogs, shiki (via real or mock answer).
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (n, c, e = "") => { R.push(`${c ? "PASS" : "FAIL"} | ${n}${e ? " | " + e : ""}`); console.log(R[R.length - 1]); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });

  // DropdownMenu
  const clearBtn = await page.$(".clear-btn");
  if (clearBtn) {
    await clearBtn.click();
    await sleep(600);
    const open = await page.evaluate(() => !!document.querySelector("[role=menu]"));
    ok("Clear ▾ DropdownMenu opens", open);
    if (open) {
      await page.evaluate(() => { const it = [...document.querySelectorAll("[role=menuitem]")].find(i => /clear all/i.test(i.textContent)); if (it) it.click(); });
      await sleep(700);
      ok("→ AlertDialog opens", await page.evaluate(() => !!document.querySelector('[role="alertdialog"]')));
      await page.evaluate(() => { const c = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Cancel"); if (c) c.click(); });
      await sleep(500);
      ok("→ Cancel closes", await page.evaluate(() => !document.querySelector('[role="alertdialog"]')));
    }
  } else ok("clear button present", false, "no conversations?");

  // Ask a question that returns code from real LLM
  await page.type('textarea[placeholder^="Ask about"]', "Show me the SQL query to check PostgreSQL connections");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  let pres = -1, shikiBlocks = -1, colored = false;
  for (let i = 0; i < 35; i++) {
    const st = await page.evaluate(() => {
      const pres = [...document.querySelectorAll(".md pre")];
      return {
        pres: pres.length,
        shiki: pres.filter(p => p.classList.contains("shiki")).length,
        colored: pres.some(p => p.querySelector("span[style*='color']")),
        len: ([...document.querySelectorAll(".msg-row.assistant .bubble")].pop() || {}).textContent?.length || 0,
      };
    });
    if (st.len > 100 && st.pres >= 0 && st.shiki > 0) { pres = st.pres; shikiBlocks = st.shiki; colored = st.colored; break; }
    if (i === 34) { pres = st.pres; shikiBlocks = st.shiki; colored = st.colored; }
    await sleep(2000);
  }
  ok("code blocks in answer", pres > 0, `${pres} pre`);
  ok("shiki highlighted", shikiBlocks > 0 && colored, `${shikiBlocks} shiki/colored=${colored}`);
  // Sign-out AlertDialog
  await page.evaluate(() => document.querySelector(".signout-btn")?.click());
  await sleep(600);
  const soDlg = await page.evaluate(() => !!document.querySelector('[role="alertdialog"]'));
  ok("sign-out AlertDialog", soDlg);
  if (soDlg) await page.evaluate(() => { const c = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Cancel"); if (c) c.click(); });
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v031-prod.png" });
  const fails = R.filter(r => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
