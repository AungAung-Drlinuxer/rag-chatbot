// Step 2 verification: refactored Tickets.tsx renders + fetches live data.
// Usage: node step2-tickets-verify.mjs   (expects preview server on :1420,
// built with VITE_API_URL=https://api.drlinuxer.com)
import puppeteer from "puppeteer-core";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "D:/ragchatbot/verify_";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));
  await page.setViewport({ width: 1360, height: 900 });

  await page.goto("http://localhost:1420/", { waitUntil: "networkidle0", timeout: 30000 });
  await page.screenshot({ path: OUT + "login.png" });

  // login with admin dev account (creds live in the cluster configmap)
  const u = await page.waitForSelector("#login-username", { timeout: 15000 });
  await u.type(process.env.VERIFY_USER);
  await page.waitForSelector("#login-password").then((p) => p.type(process.env.VERIFY_PASS));
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => /New conversation|RECENT CONVERSATIONS/i.test(document.body.innerText),
    { timeout: 25000 });
  console.log("LOGIN OK");

  // navigate to Tickets via sidebar
  const clicked = await page.evaluate(() => {
    const items = [...document.querySelectorAll("nav button, aside button, button")];
    const t = items.find((x) => /^\s*tickets\s*$/i.test(x.textContent || ""));
    if (t) { t.click(); return true; }
    return false;
  });
  console.log("clicked tickets:", clicked);
  await sleep(6000); // list fetch + jira sync-on-read

  const info = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      rows: document.querySelectorAll("table tbody tr, [class*=ticket-row], [data-ticket]").length,
      hasIthd: /ITHD-\d+|#\d{2,}/.test(txt),
      hasStatusBadges: /Open|Pending|Resolved|Closed/.test(txt),
      hasCreateBtn: /new ticket|create/i.test(txt),
      statCards: [...document.querySelectorAll(".text-2xl")].map((e) => e.textContent).slice(0, 5),
      text200: txt.slice(0, 260).replace(/\n+/g, " | "),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: OUT + "tickets.png" });

  // open the create-ticket dialog (form + assignable users path)
  const dlg = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((x) => /new ticket|create ticket/i.test(x.textContent || ""));
    if (b) { b.click(); return true; }
    return false;
  });
  await sleep(1500);
  if (dlg) {
    await page.screenshot({ path: OUT + "create-dialog.png" });
    console.log("create dialog opened:", await page.evaluate(() => /subject/i.test(document.body.innerText)));
    await page.keyboard.press("Escape");
  }
  console.log("JS ERRORS:", errors.length ? errors.slice(0, 8) : "none");
} catch (e) {
  console.log("FAIL", e.message);
} finally {
  await browser.close();
}
