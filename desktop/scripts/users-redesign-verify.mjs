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
  await sleep(2500);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, .navitem"));
    const nav = btns.find((b) => b.textContent.trim() === "Users");
    if (nav) nav.click();
  });
  await sleep(3500);
  const check = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      title: document.querySelector("h1")?.textContent?.trim(),
      statCards: t.includes("Total users") && t.includes("Active") && t.includes("Locked"),
      search: t.includes("Search by name, username or email"),
      filters: t.includes("All Status") || t.includes("All Role") || t.includes("All Department"),
      rows: document.querySelectorAll("tbody tr").length,
      pagination: t.includes("/ page"),
      groupsMgr: t.includes("Groups") && t.includes("members"),
      deptsMgr: t.includes("Departments"),
      addUser: t.includes("Add user"),
    };
  });
  console.log("page:", JSON.stringify(check));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/users-page-redesign.png" });
  // open drawer
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("tbody button"));
    btns[0]?.click();
  });
  await sleep(2000);
  const drawer = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      drawer: t.includes("User details"),
      account: t.includes("Account type") && t.includes("Last login"),
      access: t.includes("Permissions") && t.includes("Save access changes"),
      directory: t.includes("AD / LDAP groups"),
      security: t.includes("Managed by Active Directory") || t.includes("Update password"),
      resetAccess: t.includes("Reset access"),
    };
  });
  console.log("drawer:", JSON.stringify(drawer));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/users-drawer-redesign.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }