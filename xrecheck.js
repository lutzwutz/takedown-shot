// X recheck — runs on the VPS:  docker compose exec -T render node xrecheck.js
// Revisits the X posts you've noticed (via the burner session, since removal
// pages need a logged-in view) and flips ones that are gone to "removed".
// Conservative: only flips on explicit suspension/deletion text — a rate-limit
// or transient error leaves the status untouched.
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);
const fs = require("fs");

const SESSION = process.env.X_SESSION_FILE || "/app/data/x-session.json";
const RECHECK_URL = (process.env.SAAS_INGEST_URL || "").replace(/\/api\/ingest\/x$/, "/api/ingest/x/recheck");
const SECRET = process.env.SAAS_INGEST_SECRET;
const PROXY = process.env.PROXY_SERVER;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// Explicit "this post is gone" signals. Anything else = leave as-is.
const GONE = [
  "account suspended", "account is suspended", "this account doesn't exist",
  "this post was deleted", "post was deleted by the post author", "post unavailable",
  "this post is unavailable", "these posts can't be viewed", "hmm...this page doesn't exist",
  "page doesn’t exist", "page doesn't exist", "try searching for something else",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(SESSION)) { console.error("No session at", SESSION); process.exit(1); }
  if (!RECHECK_URL || !SECRET) { console.error("SAAS_INGEST_URL / SAAS_INGEST_SECRET not set"); process.exit(1); }

  const pendingRes = await fetch(`${RECHECK_URL}?secret=${SECRET}`);
  const { items } = await pendingRes.json();
  if (!items || !items.length) { console.log("nothing to recheck"); return; }
  console.log("rechecking", items.length, "X post(s)");

  const browser = await chromium.launch({ headless: true, proxy: PROXY ? { server: PROXY } : undefined });
  const ctx = await browser.newContext({ storageState: SESSION, userAgent: UA, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  if (/\/login|\/i\/flow\/login/.test(page.url())) { console.error("Session expired - re-run xlogin.js."); await browser.close(); process.exit(2); }

  const removed = [];
  for (const it of items) {
    try {
      await page.goto(it.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await sleep(3500);
      const text = (await page.evaluate(() => document.body.innerText || "")).toLowerCase();
      const gone = GONE.some((g) => text.includes(g));
      console.log(`${gone ? "GONE " : "live "} ${it.url}`);
      if (gone) removed.push(it.url);
    } catch (e) { console.error("  error", it.url, e.message); }
    await sleep(6000); // gentle pacing
  }

  if (removed.length) {
    const res = await fetch(`${RECHECK_URL}?secret=${SECRET}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ removed }),
    });
    console.log("flipped removed:", res.status, (await res.text()).slice(0, 120));
  }
  await ctx.storageState({ path: SESSION });
  await browser.close();
})();
