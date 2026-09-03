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
  await sleep(1500);
  await page.evaluate(() => { window.location.hash = "#/tickets"; });
  await sleep(2500);

  const check = await page.evaluate(() => {
    // the scroll container (has overflow-y-auto + rounded border)
    const box = Array.from(document.querySelectorAll("div")).find(
      (d) => d.className.includes("max-h-[420px]") && d.className.includes("overflow-y-auto")
    );
    if (!box) return { found: false };
    const card = box.closest("div");
    const table = box.querySelector("table");
    const rows = box.querySelectorAll("tbody tr").length;
    const headerBtns = Array.from(document.querySelectorAll("button"))
      .map((b) => b.textContent.trim())
      .filter((x) => /Export CSV|Report|Refresh/.test(x));
    return {
      found: true,
      rows,
      canScrollY: box.scrollHeight > box.clientHeight,
      scrollHeight: box.scrollHeight,
      clientHeight: box.clientHeight,
      hasHScroll: box.scrollWidth > box.clientWidth + 1,
      boxWidth: box.clientWidth,
      tableWidth: table ? table.scrollWidth : 0,
      headerBtns,
      summary: Array.from(document.querySelectorAll("span"))
        .map((s) => s.textContent.trim())
        .find((x) => x.startsWith("Showing all")) || null,
    };
  });
  console.log(JSON.stringify(check, null, 1));

  // Test CSV download
  const dl = await Promise.all([
    new Promise((res) => {
      page.once("response", async (r) => res(r.url().includes("blob") ? "blob" : "resp"));
      setTimeout(() => res("none"), 6000);
    }),
    page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.includes("Export CSV"));
      if (b) b.click();
    }),
  ]).catch(() => null);

  // Test print report popup
  const popup = new Promise((res) => browser.once("targetcreated", (tp) => res(tp.url())));
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.trim() === "Report");
    if (b) b.click();
  });
  const popUrl = await Promise.race([popup, sleep(4000).then(() => "none")]);
  console.log("print popup:", popUrl);
  console.log("csv click:", JSON.stringify(dl ? dl[0] : "err"));

  await page.evaluate(() => window.close()).catch(()=>{});
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }