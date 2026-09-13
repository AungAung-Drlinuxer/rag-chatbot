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

// ---------- #1 Knowledge: find how the list is presented ----------
await page.evaluate(() => { location.hash = "#/knowledge"; });
await sleep(6000);
const kb = await page.evaluate(() => {
  const txt = document.body.innerText;
  const heads = [...document.querySelectorAll("th")].map((t) => (t.textContent || "").trim());
  return {
    headers: heads,
    thCount: heads.length,
    hasSourceWord: /Source/.test(txt),
    allBadges: [...new Set([...document.querySelectorAll("span,div")]
      .map((e) => (e.textContent || "").trim())
      .filter((t) => /^(Confluence|ClickUp|Notion|XWiki|OpenProject|Manual)$/.test(t)))],
    tabs: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim())
      .filter((t) => /article|domain|list|browse/i.test(t)).slice(0, 8),
    excerpt: txt.slice(0, 300),
  };
});
console.log("KB:", JSON.stringify(kb, null, 1));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/kb_provider_column.png" });

// ---------- #2 chat: force a code-heavy answer ----------
await page.evaluate(() => { location.hash = "#/chat"; });
await sleep(3000);
const box = await page.$("textarea");
if (box) {
  await box.click();
  await page.keyboard.type("show me the exact kubectl commands as shell code blocks to check node status and health");
  await page.keyboard.press("Enter");
}
let ans = null;
const seen = new Set();
for (let i = 0; i < 120; i++) {
  await sleep(1000);
  ans = await page.evaluate(() => ({
    codeBlocks: document.querySelectorAll(".group\\/code").length,
    copyButtons: document.querySelectorAll('button[aria-label="Copy code"]').length,
    langs: [...new Set([...document.querySelectorAll(".group\\/code span")]
      .map((s) => (s.textContent || "").trim()).filter(Boolean))].slice(0, 4),
  }));
  if (ans.copyButtons > 0) { for (const l of ans.langs) seen.add(l); break; }
}
console.log("CODE RENDER:", JSON.stringify(ans));
if (ans && ans.copyButtons > 0) {
  const after = await page.evaluate(async () => {
    const b = document.querySelector('button[aria-label="Copy code"]');
    b.click();
    await new Promise((r) => setTimeout(r, 400));
    return b.textContent.trim();
  });
  console.log("COPY LABEL AFTER CLICK:", JSON.stringify(after));
}
await page.screenshot({ path: "D:/ragchatbot/docs/qa/answer_code_copy.png" });

// ---------- #3 source explain button ----------
const src = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter((b) => /Explain this source in detail/.test(b.textContent || ""));
  return { explainButtons: btns.length };
});
console.log("SOURCE EXPLAIN:", JSON.stringify(src));

// ---------- #4 widget: send first, then inspect actions ----------
await page.evaluate(() => { location.hash = "#/dashboard"; });
await sleep(3500);
await page.evaluate(() => window.dispatchEvent(new Event("ith:restore-assistant-btn")));
await sleep(1800);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") || "") === "Open AI assistant chat");
  if (b) b.click();
});
await sleep(3000);
const wIn = await page.evaluateHandle(() => {
  const popup = [...document.querySelectorAll("div")].find((d) =>
    /h-\[520px\]/.test(d.className || "") && /w-\[380px\]/.test(d.className || ""));
  return popup ? popup.querySelector("input:not([type=file])") : null;
});
const el = wIn.asElement();
let w = null;
if (el) {
  await el.click();
  await page.keyboard.type("show a short bash command example as a code block");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    w = await page.evaluate(() => {
      const popup = [...document.querySelectorAll("div")].find((d) =>
        /h-\[520px\]/.test(d.className || "") && /w-\[380px\]/.test(d.className || ""));
      if (!popup) return { open: false };
      return {
        open: true,
        assistantMsgs: popup.querySelectorAll(".rounded-tl-none").length,
        share: popup.querySelectorAll('button[aria-label="Share this answer"]').length,
        regen: popup.querySelectorAll('button[aria-label="Re-generate this answer"]').length,
        codeCopy: popup.querySelectorAll('button[aria-label="Copy code"]').length,
        indicator: !!popup.querySelector(".agent-shimmer-text"),
      };
    });
    if (w && (w.share > 0 || w.codeCopy > 0)) break;
  }
}
console.log("WIDGET:", JSON.stringify(w));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/widget_actions.png" });
await browser.close();