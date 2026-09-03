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
  await page.evaluate(() => { window.location.hash = "#/dashboard"; });
  await sleep(2500);
  const read = await page.evaluate(() => {
    const aside = Array.from(document.querySelectorAll("aside")).find((a) => a.offsetParent !== null);
    const main = document.querySelector("main") || document.querySelector(".page");
    const cs = (el) => el ? getComputedStyle(el).backgroundColor : null;
    return {
      theme: document.documentElement.getAttribute("data-theme"),
      sidebarBg: cs(aside),
      mainBg: main ? cs(main) : cs(document.body),
      distinct: aside && main ? cs(aside) !== cs(main) : false,
    };
  });
  const asides = await page.evaluate(() => Array.from(document.querySelectorAll("aside")).map((a) => ({
      cls: a.className.slice(0, 100), bg: getComputedStyle(a).backgroundColor, visible: a.offsetParent !== null })));
    console.log("asides:", JSON.stringify(asides));
    console.log("LIGHT:", JSON.stringify(read));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/sidebar-two-tone-light.png" });
  // switch to dark via localStorage + reload
  await page.evaluate(() => {
    const tokens = sessionStorage.getItem("tokens");
    localStorage.setItem("ith.dark", "1");
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await page.reload({ waitUntil: "networkidle0", timeout: 25000 });
  await sleep(2500);
  const dark = await page.evaluate(() => {
    const aside = Array.from(document.querySelectorAll("aside")).find((a) => a.offsetParent !== null);
    const main = document.querySelector("main") || document.querySelector(".page");
    const cs = (el) => el ? getComputedStyle(el).backgroundColor : null;
    return {
      theme: document.documentElement.getAttribute("data-theme"),
      sidebarBg: cs(aside),
      mainBg: main ? cs(main) : cs(document.body),
      distinct: aside && main ? cs(aside) !== cs(main) : false,
    };
  });
  console.log("DARK:", JSON.stringify(dark));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/sidebar-two-tone-dark.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }