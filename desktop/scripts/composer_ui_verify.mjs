import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
// iPhone-ish viewport — the screenshot that showed the clipping was a phone.
await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2", timeout: 60000 });
await sleep(3000);

const u = await page.$('input[name="username"], input#username, input[type="text"]');
if (u) {
  await u.click({ clickCount: 3 });
  await page.keyboard.type("ui-reviewer");
  const pw = await page.$('input[type="password"]');
  if (pw) { await pw.click({ clickCount: 3 }); await page.keyboard.type("UiRev!x72"); }
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
    page.keyboard.press("Enter"),
  ]).catch(() => {});
  await sleep(5000);
}

// --- composer sanity: one row, nothing clipped -----------------------------
const composer = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter((b) => {
    const t = (b.textContent || "").trim();
    return ["Auto", "Knowledge base", "Infrastructure", "Cloud only", "Local only"].includes(t);
  });
  const labels = [...document.querySelectorAll("span")].map((s) => (s.textContent || "").trim());
  const docW = document.documentElement.clientWidth;
  const overflows = [...document.querySelectorAll("button")]
    .filter((b) => b.getBoundingClientRect().right > docW + 1)
    .map((b) => (b.textContent || "").trim().slice(0, 30));
  return {
    chipButtons: btns.length,
    legacyLabels: labels.filter((l) => l === "AI ENGINE" || l === "ANSWER FROM").length,
    overflows,
    docW,
    scrollW: document.documentElement.scrollWidth,
  };
});
console.log("COMPOSER:", JSON.stringify(composer));

// --- pick Infrastructure mode from the compact control ---------------------
const opened = await page.evaluate(() => {
  for (const b of document.querySelectorAll("button")) {
    if ((b.textContent || "").trim() === "Auto") { b.click(); return true; }
  }
  return false;
});
await sleep(600);
const chose = await page.evaluate(() => {
  for (const b of document.querySelectorAll("button")) {
    const t = (b.textContent || "").trim();
    if (t.startsWith("Infrastructure")) { b.click(); return t.slice(0, 40); }
  }
  return null;
});
console.log("mode selected:", chose);
await sleep(800);

// --- ask an infrastructure question ----------------------------------------
await page.type('textarea, input[placeholder*="Ask"]', "how many deployments are in the rag-chatbot namespace right now?");
await page.keyboard.press("Enter");
await sleep(90000);

const result = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    hasSourcesHeading: /Sources & Referenced Documents/.test(txt),
    hasReferencesCount: /\\d+ references?/.test(txt),
    hasLiveBadge: /live infrastructure/i.test(txt),
    mentionsKbMatch: /KB\\s*•\\s*\\d+% match/.test(txt),
    infraAnswer: /deployments in the .*rag-chatbot/i.test(txt),
  };
});
console.log("ANSWER:", JSON.stringify(result));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/composer_mcp_mobile.png", fullPage: false });
await page.setViewport({ width: 1440, height: 1000 });
await sleep(1500);
await page.screenshot({ path: "D:/ragchatbot/docs/qa/composer_mcp_desktop.png", fullPage: false });
console.log("screenshots written");
await browser.close();