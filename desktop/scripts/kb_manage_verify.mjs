import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--ignore-certificate-errors", "--window-size=1600,1200"],
  defaultViewport: { width: 1600, height: 1200 },
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
await sleep(8000);

const audit = await page.evaluate(() => {
  const txt = document.body.innerText;
  const heads = [...document.querySelectorAll("th")].map((t) => (t.textContent || "").trim());
  return {
    heads,
    providerFilter: /Filter Source:/.test(txt),
    domainFilter: /Filter Domain:/.test(txt),
    needsReview: /Needs review/.test(txt),
    hasCheckboxes: document.querySelectorAll('input[type=checkbox]').length,
    hasQField: /Title \+ body|Title only/.test(txt),
    showingLine: (txt.match(/Showing [\d–\-\u2013]+ of \d+/) || [null])[0],
    pageSizeSel: /\/ page/.test(txt),
    headerCount: (txt.match(/Knowledge Base Articles\s*\n?\s*([\d]+[^\n]*)/) || [null, null])[1],
    tableDomains: [...document.querySelectorAll("tbody tr")].slice(0, 5).map((tr) => {
      const c = tr.querySelectorAll("td");
      return c.length > 3 ? (c[3].textContent || "").trim() : null;
    }),
    rowCount: document.querySelectorAll("tbody tr").length,
  };
});
console.log("AUDIT:", JSON.stringify(audit, null, 1));

// exercise selection -> bulk bar
await page.evaluate(() => {
  const cb = document.querySelectorAll('tbody input[type=checkbox]');
  if (cb[0]) cb[0].click();
});
await sleep(900);
const bulk = await page.evaluate(() => ({
  bar: /selected/.test(document.body.innerText),
  moveBtn: [...document.querySelectorAll("button")].some((b) => /Move/.test(b.textContent || "")),
  delBtn: [...document.querySelectorAll("button")].some((b) => /Delete/.test(b.textContent || "")),
}));
console.log("BULK BAR:", JSON.stringify(bulk));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/kb_manage_full.png" });
await browser.close();