import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCacheEnabled(false);

  // ---------- LOGIN page (desktop + small viewport) ----------
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(1200);
  const login = await page.evaluate(() => {
    const panel = document.querySelector("form")?.closest("div.max-w-\\[400px\\]");
    const r = panel?.getBoundingClientRect();
    const feat = document.querySelectorAll(".rounded-xl.border.bg-white\\/80").length;
    return {
      formInsideViewport: !!r && r.right <= window.innerWidth + 1 && r.left >= -1,
      heroVisible: !!document.querySelector("h1")?.textContent.includes("Find the right"),
      featureCards: feat,
      pageScrollOK: document.documentElement.scrollHeight <= window.innerHeight + 60,
    };
  });
  console.log("login@1440:", JSON.stringify(login));
  await page.setViewport({ width: 1100, height: 700 });
  await sleep(800);
  const login2 = await page.evaluate(() => {
    const panel = document.querySelector("form")?.closest("div.max-w-\\[400px\\]");
    const r = panel?.getBoundingClientRect();
    return { formInsideViewport: !!r && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 80, clipped: !!r && r.right > window.innerWidth };
  });
  console.log("login@1100x700:", JSON.stringify(login2));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/login-fixed.png" });

  // sign in for the rest
  await page.setViewport({ width: 1440, height: 1000 });
  await page.type('input[type="text"]', "ith@dmin", { delay: 15 });
  await page.type('input[type="password"]', "Pwint@160320", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(2500);
  async function goto(label) {
    await page.evaluate((l) => {
      Array.from(document.querySelectorAll("button, .navitem")).find((b) => b.textContent.trim() === l)?.click();
    }, label);
    await sleep(3500);
  }

  // ---------- KNOWLEDGE ----------
  await goto("Knowledge");
  const kb = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      oneSearchBar: (t.match(/Search for solutions|Search articles/g) || []).length <= 1,
      searchArticlesGone: !t.includes("Search articles..."),
      recentHiddenForAdmin: !t.includes("Recently updated"),
      managePresent: t.includes("Manage knowledge base"),
      noStuckPagesSync: !/\d+\s*pagesSynced/.test(t),
    };
  });
  console.log("knowledge:", JSON.stringify(kb));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/knowledge-fixed.png" });

  // ---------- DASHBOARD ----------
  await goto("Dashboard");
  const db = await page.evaluate(() => {
    const t = document.body.innerText;
    const center = t.match(/(\d+(?:\.\d+)?)%\s*Escalation Rate/);
    const hasView = t.includes("View");
    return { realDonutPct: !!center && center[1] !== "10.2", donut: center?.[1], hasViewAction: hasView, noHardcoded252: !t.includes("252") };
  });
  console.log("dashboard:", JSON.stringify(db));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/dashboard-fixed.png" });

  // ---------- TICKETS ----------
  await goto("Tickets");
  const tk = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      bannerGone: !t.includes("Need help with an unresolved issue?"),
      commentBox: t.includes("Write a comment"),
      noDupAddComment: !t.includes("Add comment"),
    };
  });
  console.log("tickets:", JSON.stringify(tk));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/tickets-fixed.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }