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
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(2500);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const nav = btns.find((b) => b.textContent.includes("Integrations") && b.textContent.includes("External services"));
    if (nav) nav.click();
  });
  await sleep(3000);
  const check = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      statusCards: ["Confluence", "Jira", "LDAP / Active Directory", "H-Chat (LLM API)", "Redis"].map((n) => ({
        name: n, shown: t.includes(n),
        connected: new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]{0,200}Connected").test(t),
      })),
      smtpStillThere: t.includes("SMTP Host"),
      subTabsStillThere: t.includes("Confluence") && t.includes("Ollama Embeddings"),
    };
  });
  console.log(JSON.stringify(check, null, 1));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/settings-integrations-v2.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }