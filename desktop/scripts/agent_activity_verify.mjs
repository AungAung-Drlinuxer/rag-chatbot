import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--ignore-certificate-errors", "--window-size=1600,1100"],
  defaultViewport: { width: 1600, height: 1100 },
});
const page = await browser.newPage();

async function login() {
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
}

await login();

// --- 1) Chat page: send a question and catch the live activity indicator ---
const box = await page.$("textarea");
if (box) {
  await box.click();
  await page.keyboard.type("how do I check kubernetes node health");
  await sleep(200);
  await page.keyboard.press("Enter");
  console.log("question sent");
} else {
  console.log("NO TEXTAREA FOUND");
}

// poll for the animated indicator to appear, then shoot
let found = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  found = await page.evaluate(() => {
    const el = document.querySelector('[role="status"].agent-shimmer-text, .agent-shimmer-text');
    const wrap = el ? el.closest('[role="status"]') : null;
    return {
      shimmer: !!el,
      label: el ? el.textContent.trim() : null,
      orbiting: !!document.querySelector(".agent-orbit"),
      halo: !!document.querySelector(".agent-halo"),
      iconPop: !!document.querySelector(".agent-icon-pop"),
      dots: document.querySelectorAll(".agent-dot").length,
      aria: wrap ? wrap.getAttribute("aria-label") : null,
    };
  });
  if (found.shimmer) break;
}

console.log("CHAT PAGE INDICATOR:", JSON.stringify(found));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/agent_activity_chat.png" });

// watch the label change as the pipeline advances (proves the stage icon/label swaps)
const seen = new Set();
for (let i = 0; i < 30; i++) {
  const lbl = await page.evaluate(() => {
    const el = document.querySelector(".agent-shimmer-text");
    return el ? el.textContent.trim() : null;
  });
  if (lbl) seen.add(lbl);
  await sleep(700);
  if (seen.size >= 3) break;
}
console.log("STAGE LABELS OBSERVED:", JSON.stringify([...seen]));

// --- 2) Floating AI Assistant widget ---
await page.evaluate(() => {
  const fab = [...document.querySelectorAll("button")].find((b) =>
    /open ai assistant/i.test(b.getAttribute("aria-label") || "") || /open chat/i.test(b.textContent || "")
  );
  if (fab) fab.click();
});
await sleep(2500);

const widget = await page.evaluate(() => {
  const popup = document.querySelector(".fixed.bottom-5.right-5.z-50");
  if (!popup) return { open: false };
  const txt = popup.innerText;
  return {
    open: true,
    hasAssistantAvatar: popup.querySelectorAll(".rounded-xl.bg-blue-600").length > 0,
    hasMarkdownClass: !!popup.querySelector(".md"),
    header: /IT Knowledge Assistant/.test(txt),
    placeholder: (popup.querySelector("input") || {}).placeholder || null,
    bubbleRounded2xl: popup.querySelectorAll(".rounded-2xl").length,
  };
});
console.log("FLOATING WIDGET:", JSON.stringify(widget));

// send inside the widget and catch its animated indicator
const wInput = await page.evaluateHandle(() => {
  const popup = document.querySelector(".fixed.bottom-5.right-5.z-50");
  return popup ? popup.querySelector("input:not([type=file])") : null;
});
const inp = wInput.asElement();
if (inp) {
  await inp.click();
  await page.keyboard.type("what is a vpn");
  await page.keyboard.press("Enter");
  await sleep(4000);
  const wAudit = await page.evaluate(() => {
    const popup = document.querySelector(".fixed.bottom-5.right-5.z-50");
    const el = popup ? popup.querySelector(".agent-shimmer-text") : null;
    return {
      widgetIndicator: !!el,
      label: el ? el.textContent.trim() : null,
      orbiting: popup ? !!popup.querySelector(".agent-orbit") : false,
    };
  });
  console.log("WIDGET INDICATOR:", JSON.stringify(wAudit));
  await page.screenshot({ path: "D:/ragchatbot/docs/qa/agent_activity_widget.png" });
} else {
  console.log("widget input not found");
}

await browser.close();