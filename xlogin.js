// Run this LOCALLY on your own machine (NOT the VPS):  node xlogin.js
// It opens a real browser. Log into your dedicated BURNER X account by hand,
// then press Enter here. It saves the session to ./x-session.json, which you
// then upload to the VPS at ~/takedown-shot/data/x-session.json.
//
// Using a burner (not your real account) keeps the blast radius to zero if X
// ever flags it. Never put your personal X account here.
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);
const readline = require("readline");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("https://x.com/login");
  console.log("\n>>> Log into the BURNER X account in the window, get to the home feed, then press Enter here.\n");
  await new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", () => { rl.close(); res(); });
  });
  await ctx.storageState({ path: "x-session.json" });
  console.log("\nSaved x-session.json. Upload it to the VPS:  ~/takedown-shot/data/x-session.json\n");
  await browser.close();
})();
