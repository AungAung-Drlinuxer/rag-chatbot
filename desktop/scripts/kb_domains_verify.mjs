import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--ignore-certificate-errors", "--window-size=430,932"],
  defaultViewport: { width: 430, height: 932, isMobile: true, hasTouch: true },
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
await sleep(7000);

const out = await page.evaluate(() => {
  // domain chips are the horizontal scroll row of buttons/divs under the search box
  const labels = [...document.querySelectorAll("button,div,span")]
    .map((e) => (e.textContent || "").trim())
    .filter((t) => /^(All Domains|General IT|Database|Network & Connectivity|Security & Identity|Server & Hardware|Kubernetes & Cloud|Storage & Backups|Help Desk & Support|Software Development|Blockchain & Smart Contracts|AWS & Cloud Services|System)$/.test(t));
  const counts = {};
  labels.forEach((l) => { counts[l] = (counts[l] || 0) + 1; });
  // the Domain column cells in the table
  const tableDomains = [...document.querySelectorAll("tbody tr")].map((tr) => {
    const c = tr.querySelectorAll("td");
    return c.length > 2 ? (c[2].textContent || "").trim() : null;
  }).filter(Boolean);
  return { chipLabels: counts, tableDomains: tableDomains.slice(0, 8) };
});
console.log("CHIPS:", JSON.stringify(out.chipLabels));
console.log("TABLE DOMAIN COLUMN:", JSON.stringify(out.tableDomains));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/kb_domains_mobile.png" });
await browser.close();