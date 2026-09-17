import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2", timeout: 60000 });
await sleep(3000);
const u = await page.$('input[name="username"], input#username, input[type="text"]');
if (u) {
  await u.click({ clickCount: 3 });
  await page.keyboard.type("ui2-reviewer");
  const pw = await page.$('input[type="password"]');
  if (pw) { await pw.click({ clickCount: 3 }); await page.keyboard.type("Ui2Rev!x72"); }
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
    page.keyboard.press("Enter"),
  ]).catch(() => {});
  await sleep(5000);
}

// 1) ask a KB question first -> expect the "Ask this in Infrastructure mode" button
await page.type('textarea, input[placeholder*="Ask"]', "what is a kubernetes pod?");
await page.keyboard.press("Enter");
await sleep(75000);

const kb = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    askLiveButton: /Ask this in Infrastructure mode/i.test(t),
    hasSources: /Sources & Referenced Documents/.test(t),
    hasEvidenceCard: /Live infrastructure/i.test(t),
  };
});
console.log("KB ANSWER:", JSON.stringify(kb));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/kb_with_asklive.png", fullPage: false });

// 2) click it -> should re-ask in Infrastructure mode
const clicked = await page.evaluate(() => {
  for (const b of document.querySelectorAll("button")) {
    if (/Ask this in Infrastructure mode/i.test(b.textContent || "")) { b.click(); return true; }
  }
  return false;
});
console.log("clicked ask-live:", clicked);
await sleep(90000);

const live = await page.evaluate(() => {
  const t = document.body.innerText;
  const docW = document.documentElement.clientWidth;
  return {
    hasEvidenceCard: /Live infrastructure/i.test(t),
    evidenceHasCalls: /call(s)?\b/i.test(t),
    hasSources: /Sources & Referenced Documents/.test(t),
    hasConfidence: /\b\d{1,3}% match\b/.test(t),
    overflows: [...document.querySelectorAll("button")]
      .filter((b) => b.getBoundingClientRect().right > docW + 1).length,
    scrollW: document.documentElement.scrollWidth,
    docW,
    composerChips: [...document.querySelectorAll("button")].filter((b) =>
      ["Auto", "Knowledge base", "Infrastructure", "Cloud only", "Local only"]
        .includes((b.textContent || "").trim())).length,
  };
});
console.log("AFTER ASK-LIVE:", JSON.stringify(live));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/live_evidence_mobile.png", fullPage: false });

// 3) mobile detail toggle (the panel that used to be desktop-only)
const toggled = await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="Toggle answer detail"]');
  if (!b) return "not-found";
  b.click();
  return "clicked";
});
await sleep(1500);
const detail = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    panelShown: /Live infrastructure|Retrieval information/.test(t),
    showsReadOnly: /Read-only/.test(t),
    showsRole: /Role scope|Access/.test(t),
  };
});
console.log("detail toggle:", toggled, JSON.stringify(detail));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/mobile_detail_panel.png", fullPage: false });
console.log("screenshots written");
await browser.close();
