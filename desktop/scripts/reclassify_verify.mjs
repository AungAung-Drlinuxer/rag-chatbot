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
await page.keyboard.press("Escape");
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Knowledge");
  if (b) b.click();
});
await sleep(6500);

// open the Re-classify panel
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /Re-classify KB/.test(x.textContent || ""));
  if (b) b.click();
});
await sleep(1500);
const panel = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    panelOpen: /Re-classify the knowledge base/.test(txt),
    previewBtn: /Preview changes/.test(txt),
    applyBtn: /Apply/.test(txt),
    explainCopy: /Nothing is written until you apply it/.test(txt),
    domainChips: [...document.querySelectorAll("button,span")]
      .map((e) => (e.textContent || "").trim())
      .filter((t) => /^(General IT|Software Development|Blockchain & Smart Contracts|AWS & Cloud Services|Server & Hardware|Kubernetes & Cloud)$/.test(t)).slice(0, 8),
  };
});
console.log("PANEL:", JSON.stringify(panel));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/reclassify_panel.png", fullPage: false });
await browser.close();