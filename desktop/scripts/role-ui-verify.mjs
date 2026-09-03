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

  // 1) Sidebar shows pretty role badge for admin
  const foot = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("span"));
    const b = els.find((s) => /Administrator|IT Support|Knowledge Manager/.test(s.textContent.trim()) && s.className.includes("rounded-full"));
    return b ? b.textContent.trim() : "(none)";
  });
  console.log("sidebar role badge:", foot);

  // 2) Users page: AungAung drawer -> RoleAssignCard visible with 4 role cards
  await page.evaluate(() => { window.location.hash = "#/users"; });
  await sleep(2500);
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    for (const r of rows) {
      if (r.textContent.includes("AungAung")) { r.querySelector("button").click(); return true; }
    }
    return false;
  });
  await sleep(1800);
  const drawer = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      hasAssign: t.includes("Assign role"),
      cards: ["Administrator", "IT Support", "Knowledge Manager", "User"].filter((x) => t.includes(x)),
      hasEffective: t.includes("Effective permissions"),
      saveBtn: !!Array.from(document.querySelectorAll("button")).find((b) => /Assign role/.test(b.textContent)),
    };
  });
  console.log("role drawer:", JSON.stringify(drawer));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/role-assign.png" });

  // 3) pick Knowledge Manager then check "Will assign" + Save enabled
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const card = btns.find((b) => b.textContent.includes("Knowledge Manager") && b.textContent.includes("manage knowledge"));
    if (card) card.click();
  });
  await sleep(600);
  const picked = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/Will assign: [^\n]+/);
    const save = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Assign role");
    return { willAssign: m ? m[0] : null, saveEnabled: save ? !save.disabled : null };
  });
  console.log("picked:", JSON.stringify(picked));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/role-picked.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }