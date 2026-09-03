// v0.3.1 prod recheck — patient waits: dropdown after convos load, shiki after long stream.
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

  // Wait for conversations to actually load before checking clear button
  let clearBtn = null;
  for (let i = 0; i < 15 && !clearBtn; i++) { clearBtn = await page.$(".clear-btn"); if (!clearBtn) await sleep(1000); }
  if (clearBtn) {
    await clearBtn.click();
    await sleep(700);
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
  } else ok("clear button present", false, "no convos loaded");

  // Ask and wait patiently (up to 3 min) for stream to finish, then check pre/shiki
  await page.type('textarea[placeholder^="Ask about"]', "Show me a SQL query to list active database connections");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  let st = null;
  for (let i = 0; i < 90; i++) {
    st = await page.evaluate(() => {
      const pres = [...document.querySelectorAll(".msg-row.assistant .md pre")];
      const typing = !!document.querySelector(".typing-dots");
      return {
        pres: pres.length,
        shiki: pres.filter(p => p.classList.contains("shiki")).length,
        colored: pres.some(p => p.querySelector("span[style*='color']")),
        typing,
        len: ([...document.querySelectorAll(".msg-row.assistant .bubble")].pop() || {}).textContent?.length || 0,
      };
    });
    if (!st.typing && st.len > 50) break; // stream finished
    await sleep(2000);
  }
  ok("answer finished streaming", st && !st.typing && st.len > 50, `len=${st?.len}`);
  ok("code blocks present", (st?.pres || 0) > 0, `${st?.pres} pre`);
  ok("shiki highlighted", (st?.shiki || 0) > 0 && st?.colored, `${st?.shiki} shiki`);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v031-prod-recheck.png" });
  const fails = R.filter(r => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
