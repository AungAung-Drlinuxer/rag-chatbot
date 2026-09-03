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
  await page.setCacheEnabled(false);
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(500);
  await page.type('input[type="text"]', "ith@dmin", { delay: 15 });
  await page.type('input[type="password"]', "Pwint@160320", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(5000);
  // find sidebar "Conversations" nav item and click
  const navTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll("nav button, aside button")).map((b) => b.textContent.trim().slice(0, 30)));
  console.log("nav items:", JSON.stringify(navTexts));
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("nav button, aside button"));
    const nav = btns.find((b) => b.textContent.trim().startsWith("Conversations"));
    if (nav) { nav.click(); return true; }
    return false;
  });
  await sleep(5000);
  const check = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      title: document.querySelector("h1")?.textContent?.trim(),
      badge: t.includes("Admin audit"),
      statChips: t.includes("CONVERSATIONS") || t.includes("Conversations"),
      hasTotal: t.toLowerCase().includes("total messages"),
      rows: t.includes("Last activity") || t.includes("LAST ACTIVITY"),
      rowsCount: document.querySelectorAll("tbody tr").length,
      exportBtns: (t.includes("txt") || t.includes("json")),
      sidebarActive: !!document.querySelector(".navitem.active")?.textContent.includes("Conversations"),
    };
  });
  console.log("clicked:", clicked, "| page:", JSON.stringify(check));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/conversation-history-page.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }