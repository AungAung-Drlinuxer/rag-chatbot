import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(500);
  await page.type('input[type="text"]', "ith@dmin", { delay: 15 });
  await page.type('input[type="password"]', "Pwint@160320", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(2000);
  await page.evaluate(() => { window.location.hash = "#/users"; });
  await sleep(2500);
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    for (const r of rows) { if (r.textContent.includes("AungAung")) { r.querySelector("button").click(); return; } }
  });
  await sleep(1800);
  // click the Knowledge Manager ROLE CARD (button whose bold title text starts with it)
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    // role card = button that contains the blurb text
    const card = btns.find((b) => b.textContent.includes("manage KB content & sync"));
    if (card) { card.click(); return true; }
    return false;
  });
  await sleep(800);
  const state = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/Will assign: [^\n]+/);
    const save = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Assign role");
    return { clickedOk: !!(save), willAssign: m ? m[0] : null, saveDisabled: save ? save.disabled : null };
  });
  console.log("click card:", clicked, "| state:", JSON.stringify(state));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/role-picked.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }