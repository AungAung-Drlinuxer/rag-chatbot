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

// list every candidate launcher so we can see what is actually rendered
const candidates = await page.evaluate(() =>
  [...document.querySelectorAll("button")].map((b, i) => ({
    i,
    aria: b.getAttribute("aria-label"),
    title: b.getAttribute("title"),
    text: (b.textContent || "").trim().slice(0, 30),
    cls: (b.className || "").slice(0, 80),
  })).filter((b) => /assistant|chat|help|bot/i.test(`${b.aria} ${b.title} ${b.text} ${b.cls}`))
);
console.log("LAUNCHER CANDIDATES:", JSON.stringify(candidates.slice(0, 6)));

// The FAB is intentionally NOT mounted on the chat page (it must never occlude the
// composer), so drive the widget from the dashboard instead.
await page.evaluate(() => { location.hash = "#/dashboard"; });
await sleep(3500);

// 1) make sure the floating FAB is not in the dismissed state
await page.evaluate(() => window.dispatchEvent(new Event("ith:restore-assistant-btn")));
await sleep(1800);

// 2) click the real launcher (exact aria-label — a sibling button also says "assistant")
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find(
    (x) => (x.getAttribute("aria-label") || "") === "Open AI assistant chat"
  );
  if (!b) return false;
  b.click();
  return true;
});
console.log("clicked FAB:", clicked);
await sleep(3200);

const widget = await page.evaluate(() => {
  const popup = [...document.querySelectorAll("div")].find((d) =>
    /h-\[520px\]/.test(d.className || "") && /w-\[380px\]/.test(d.className || "")
  );
  if (!popup) return { open: false };
  const txt = popup.innerText;
  return {
    open: true,
    header: /IT Knowledge Assistant/.test(txt),
    avatarBlue: popup.querySelectorAll(".bg-blue-600").length,
    mdClass: !!popup.querySelector(".md"),
    placeholder: (popup.querySelector("input:not([type=file])") || {}).placeholder || null,
  };
});
console.log("WIDGET:", JSON.stringify(widget));

if (widget.open) {
  const inp = await page.evaluateHandle(() => {
    const popup = [...document.querySelectorAll("div")].find((d) =>
      /h-\[520px\]/.test(d.className || "") && /w-\[380px\]/.test(d.className || "")
    );
    return popup ? popup.querySelector("input:not([type=file])") : null;
  });
  const el = inp.asElement();
  if (el) {
    await el.click();
    await page.keyboard.type("what is a vpn");
    await page.keyboard.press("Enter");
    let got = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      got = await page.evaluate(() => {
        const popup = [...document.querySelectorAll("div")].find((d) =>
          /h-\[520px\]/.test(d.className || "") && /w-\[380px\]/.test(d.className || "")
        );
        const s = popup ? popup.querySelector(".agent-shimmer-text") : null;
        return s ? { label: s.textContent.trim(), orbit: !!popup.querySelector(".agent-orbit") } : null;
      });
      if (got) break;
    }
    console.log("WIDGET INDICATOR:", JSON.stringify(got));
    await page.screenshot({ path: "D:/ragchatbot/docs/qa/agent_activity_widget.png" });
  } else {
    console.log("widget input not found");
  }
}
await browser.close();