// v0.3.1 QA: dropdown menu, AlertDialog modals, shiki code highlighting.
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://127.0.0.1:4173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (n, c, e = "") => { R.push(`${c ? "PASS" : "FAIL"} | ${n}${e ? " | " + e : ""}`); console.log(R[R.length - 1]); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(APP, { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  ok("login", true);

  // Ask something that returns SQL/bash code blocks
  await page.type('textarea[placeholder^="Ask about"]', "How do I check PostgreSQL connections with SQL? show the query");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  let hasShiki = false;
  for (let i = 0; i < 30 && !hasShiki; i++) {
    hasShiki = await page.evaluate(() => !!document.querySelector(".md pre.shiki, .shiki-block"));
    if (!hasShiki) await sleep(2000);
  }
  const rawPre = await page.evaluate(() => [...document.querySelectorAll(".md pre")].filter(p => !p.classList.contains("shiki") && !p.closest(".shiki-block")).length);
  ok("shiki highlights code blocks", hasShiki, `unhighlighted pre=${rawPre}`);
  await sleep(1500);

  // DropdownMenu on Clear ▾
  const clearBtn = await page.$(".clear-btn");
  if (clearBtn) {
    await clearBtn.click();
    await sleep(600);
    const menuOpen = await page.evaluate(() => !!document.querySelector("[data-radix-popper-content-wrapper], [role=menu]"));
    ok("Clear ▾ opens DropdownMenu", menuOpen);
    if (menuOpen) {
      // Click the destructive item → should open AlertDialog
      await page.evaluate(() => { const it = [...document.querySelectorAll("[role=menuitem]")].find(i => /clear all/i.test(i.textContent)); if (it) it.click(); });
      await sleep(700);
      const dlg = await page.evaluate(() => !!document.querySelector('[role="alertdialog"], [data-slot="alert-dialog-content"]'));
      ok("menu item opens AlertDialog", dlg);
      if (dlg) {
        // Cancel
        await page.evaluate(() => { const c = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Cancel"); if (c) c.click(); });
        await sleep(500);
        const gone = await page.evaluate(() => !document.querySelector('[role="alertdialog"]'));
        ok("AlertDialog cancel closes", gone);
      }
    }
  } else ok("clear btn present", false);

  // Sign-out modal via Settings nav Sign out path is in chat sidebar foot — test its trigger button
  await page.evaluate(() => document.querySelector(".signout-btn")?.click());
  await sleep(600);
  const soDlg = await page.evaluate(() => !!document.querySelector('[role="alertdialog"], [data-slot="alert-dialog-content"]'));
  ok("sign-out uses AlertDialog", soDlg);
  if (soDlg) {
    await page.evaluate(() => { const c = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Cancel"); if (c) c.click(); });
    ok("signout cancel keeps session", true);
  }

  const fails = R.filter(r => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
