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
  await sleep(4000);
  const check = await page.evaluate(() => {
    const box = Array.from(document.querySelectorAll("div")).find(
      (d) => typeof d.className === "string" && d.className.indexOf("max-h-[480px]") >= 0
    );
    const big = getComputedStyle(document.querySelector("main") || document.body).fontSize;
    return {
      scrollBox: !!box,
      canScrollY: box ? box.scrollHeight > box.clientHeight : null,
      hOverflow: box ? box.scrollWidth > box.clientWidth + 1 : null,
      baseFont: big,
      mockDepts: ["IT Infrastructure","Application","Database"].filter((d) =>
        document.body.innerText.includes(d)),
      hasGroupsMgr: document.body.innerText.includes("Groups"),
      hasDeptMgr: document.body.innerText.includes("Departments"),
    };
  });
  console.log(JSON.stringify(check, null, 1));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/users-final.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }