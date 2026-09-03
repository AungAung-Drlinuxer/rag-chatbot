// QA: Chat page + Users page render correctly
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 150)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#login-username", "dev");
  await page.type("#login-password", "dev");
  await sleep(500);
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /sign in/i.test(b.textContent));
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log("clicked sign in:", clicked);
  await sleep(3000);
  const bodyNow = await page.evaluate(() => document.body.innerText.slice(0, 250));
  console.log("AFTER LOGIN BODY:", JSON.stringify(bodyNow));

  // Chat page (default nav=chat)
  const chatOk = await page.evaluate(() => !!document.querySelector("textarea[placeholder='Ask an IT question...']"));
  console.log("Chat page renders:", chatOk);

  // Users page (via new Chat sidebar nav)
  const clickedUsers = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const u = btns.find((x) => x.textContent.trim() === "Users");
    if (u) { u.click(); return true; }
    return false;
  });
  await sleep(1200);
  const usersOk = await page.evaluate(() => {
    const el = document.querySelector('[data-nav="users"]') || document.body;
    return el.innerText.includes("Total users") || document.body.innerText.includes("Total users");
  });
  console.log("Users page renders:", usersOk);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/users-qa.png" });

  // Tickets still OK
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const t = btns.find((x) => x.textContent.trim() === "Tickets");
    if (t) t.click();
  });
  await sleep(1500);
  const ticketsOk = await page.evaluate(() => document.body.innerText.includes("Total tickets"));
  console.log("Tickets page renders:", ticketsOk);

  // Settings page
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const s = btns.find((x) => x.textContent.trim() === "Settings");
    if (s) s.click();
  });
  await sleep(1500);
  const settingsOk = await page.evaluate(() =>
    document.body.innerText.includes("Administration") && document.body.innerText.includes("AI & RAG"));
  console.log("Settings page renders:", settingsOk);
  console.log("ERRORS:", errors.slice(0, 4));
} catch (e) {
  console.log("FAIL", e.message);
} finally {
  await browser.close();
}