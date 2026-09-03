// v0.4.4 QA: modal padding/spacing metrics + mobile screenshot of Not-Helpful dialog.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await page.type('textarea[placeholder^="Ask about"]', "VPN drops often");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  for (let i = 0; i < 20; i++) {
    const done = await page.evaluate(() => { const b = [...document.querySelectorAll("button.btn.unhelpful")].pop(); return b && !b.disabled; });
    if (done) break;
    await sleep(1500);
  }
  await page.evaluate(() => [...document.querySelectorAll("button.btn.unhelpful")].pop()?.click());
  await sleep(800);
  const m = await page.evaluate(() => {
    const d = document.querySelector('[data-slot="alert-dialog-content"]');
    if (!d) return null;
    const cs = getComputedStyle(d);
    const box = d.getBoundingClientRect();
    const reasons = [...d.querySelectorAll(".nh-reason")];
    const rH = reasons[0]?.getBoundingClientRect().height ?? 0;
    const cancel = d.querySelector('[data-slot="alert-dialog-cancel"]');
    const cBox = cancel?.getBoundingClientRect();
    return {
      padTop: cs.paddingTop, padRight: cs.paddingRight, padBottom: cs.paddingBottom, padLeft: cs.paddingLeft,
      reasonHeight: Math.round(rH),
      gapTitleDesc: (() => { const t = d.querySelector('[data-slot="alert-dialog-title"]'); const s = d.querySelector('[data-slot="alert-dialog-description"]'); if (!t || !s) return null; return Math.round(s.getBoundingClientRect().top - t.getBoundingClientRect().bottom); })(),
      descToListGap: (() => { const s = d.querySelector('[data-slot="alert-dialog-description"]'); const f = reasons[0]; if (!s || !f) return null; return Math.round(f.getBoundingClientRect().top - s.getBoundingClientRect().bottom); })(),
      cancelMarginOK: cBox ? (cBox.right <= box.right - 12 && cBox.bottom <= box.bottom - 12) : null,
      cancelWidth: cBox ? Math.round(cBox.width) : 0,
      cancelClipped: cBox ? cBox.width < 60 : true,
    };
  });
  console.log(JSON.stringify(m, null, 1));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v044-modal-spacing.png" });
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
