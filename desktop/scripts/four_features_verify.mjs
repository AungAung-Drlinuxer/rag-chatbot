import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--ignore-certificate-errors", "--window-size=1600,1100"],
  defaultViewport: { width: 1600, height: 1100 },
});
const page = await browser.newPage();
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1500);
await page.evaluate(() => { location.hash = "#/login"; });
await sleep(1200);
const inputs = await page.$$("input");
if (inputs.length >= 2) {
  await inputs[0].click({ clickCount: 3 }); await inputs[0].type("ui-reviewer");
  await inputs[1].click({ clickCount: 3 }); await inputs[1].type("UiReview!x72");
  await page.keyboard.press("Enter");
  await sleep(4500);
}

// ---------- #1 Knowledge page: provider column ----------
await page.evaluate(() => { location.hash = "#/knowledge"; });
await sleep(5000);
const kb = await page.evaluate(() => {
  const txt = document.body.innerText;
  const heads = [...document.querySelectorAll("th")].map((t) => (t.textContent || "").trim());
  const badges = [...document.querySelectorAll("tbody tr td span, tbody tr td div")]
    .map((e) => (e.textContent || "").trim())
    .filter((t) => /^(Confluence|ClickUp|Notion|XWiki|OpenProject|Manual|Unknown)$/.test(t));
  const counts = {};
  for (const b of badges) counts[b] = (counts[b] || 0) + 1;
  return { headers: heads, badgeSample: counts, hasSourceColumn: heads.includes("Source") };
});
console.log("KNOWLEDGE:", JSON.stringify(kb));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/kb_provider_column.png" });

// ---------- #2 chat answer with a command + copy buttons ----------
await page.evaluate(() => { location.hash = "#/chat"; });
await sleep(3000);
const box = await page.$("textarea");
if (box) {
  await box.click();
  await page.keyboard.type("give me the exact kubectl commands to check node health");
  await page.keyboard.press("Enter");
  console.log("chat question sent");
}
let ans = null;
for (let i = 0; i < 100; i++) {
  await sleep(1000);
  ans = await page.evaluate(() => {
    const codeBlocks = [...document.querySelectorAll(".group\\/code")];
    const btns = [...document.querySelectorAll('button[aria-label="Copy code"]')];
    const langs = [...document.querySelectorAll(".group\\/code span")].map((s) => (s.textContent || "").trim()).filter(Boolean);
    return {
      codeBlocks: codeBlocks.length,
      copyButtons: btns.length,
      langs: [...new Set(langs)].slice(0, 5),
      hasExplainSource: /Explain this source in detail/.test(document.body.innerText),
    };
  });
  if (ans.codeBlocks > 0) break;
}
console.log("ANSWER RENDER:", JSON.stringify(ans));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/answer_code_copy.png" });

// click a copy button and confirm it flips to "Copied"
const copyState = await page.evaluate(async () => {
  const b = document.querySelector('button[aria-label="Copy code"]');
  if (!b) return null;
  b.click();
  await new Promise((r) => setTimeout(r, 500));
  return b.textContent.trim();
});
console.log("COPY BUTTON AFTER CLICK:", JSON.stringify(copyState));

// ---------- #4 floating widget ----------
await page.evaluate(() => { location.hash = "#/dashboard"; });
await sleep(3500);
await page.evaluate(() => window.dispatchEvent(new Event("ith:restore-assistant-btn")));
await sleep(1800);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") || "") === "Open AI assistant chat");
  if (b) b.click();
});
await sleep(3000);
const w = await page.evaluate(() => {
  const popup = [...document.querySelectorAll("div")].find((d) =>
    /h-\[520px\]/.test(d.className || "") && /w-\[380px\]/.test(d.className || ""));
  if (!popup) return { open: false };
  return {
    open: true,
    shareBtn: !!popup.querySelector('button[aria-label="Share this answer"]'),
    regenBtn: !!popup.querySelector('button[aria-label="Re-generate this answer"]'),
    copyBtn: !!popup.querySelector('button[aria-label*="Copy"]'),
    placeholder: (popup.querySelector("input:not([type=file])") || {}).placeholder || null,
  };
});
console.log("WIDGET ACTIONS:", JSON.stringify(w));
await browser.close();