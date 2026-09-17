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
  await page.keyboard.type("ui3-reviewer");
  const pw = await page.$('input[type="password"]');
  if (pw) { await pw.click({ clickCount: 3 }); await page.keyboard.type("Ui3Rev!x72"); }
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
    page.keyboard.press("Enter"),
  ]).catch(() => {});
  await sleep(5000);
}

// header should now carry the answer-source control on a phone
const header = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const visible = (b) => b.getBoundingClientRect().width > 0;
  const chip = btns.find((b) => visible(b) && ["Auto", "Knowledge base", "Infrastructure"]
    .includes((b.textContent || "").trim()));
  const inHeader = chip ? Boolean(chip.closest("header")) : false;
  const composer = btns.filter((b) => visible(b) && ["Auto", "Knowledge base", "Infrastructure"]
    .includes((b.textContent || "").trim()));
  return { modeControlsVisible: composer.length, locatedInHeader: inHeader };
});
console.log("PHONE HEADER:", JSON.stringify(header));

// pick Infrastructure from the header control
await page.evaluate(() => {
  const b = [...document.querySelectorAll("header button")].find((x) =>
    ["Auto", "Knowledge base", "Infrastructure"].includes((x.textContent || "").trim()));
  if (b) b.click();
});
await sleep(700);
const picked = await page.evaluate(() => {
  for (const b of document.querySelectorAll("button")) {
    if ((b.textContent || "").trim().startsWith("Infrastructure")) { b.click(); return true; }
  }
  return false;
});
console.log("picked Infrastructure in header:", picked);
await sleep(800);

await page.type('textarea, input[placeholder*="Ask"]', "how many deployments are in the rag-chatbot namespace right now?");
await page.keyboard.press("Enter");
await sleep(90000);

const res = await page.evaluate(() => {
  const t = document.body.innerText;
  const docW = document.documentElement.clientWidth;
  return {
    trackerTitleLive: /Infrastructure query/.test(t),
    trackerTitleRag: /RAG Pipeline/.test(t),
    evidenceCard: /Live infrastructure/.test(t),
    showFullOutput: /Show full output/.test(t),
    heldBackNote: /more line\(s\)/.test(t),
    sourcesSection: /Sources & Referenced Documents/.test(t),
    overflows: [...document.querySelectorAll("button")]
      .filter((b) => b.getBoundingClientRect().right > docW + 1).length,
    scrollW: document.documentElement.scrollWidth,
    docW,
  };
});
console.log("AFTER LIVE ASK:", JSON.stringify(res));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/p2_final_mobile.png", fullPage: false });
console.log("screenshot written");
await browser.close();
