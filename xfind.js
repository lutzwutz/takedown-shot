// Operator X-finder — runs on the VPS:  docker compose exec -T render node xfind.js
// Low-frequency, logged-in (burner session) search of X for likely-piracy posts.
// Keyword-gated, posts candidates to the SaaS for REVIEW. It never files anything.
//
// Reads:
//   data/x-session.json     burner session (created locally with xlogin.js)
//   data/xfind.config.json  [{ "titleId": "...", "title": "Citizen Vigilante" }]
// Env (set on the render service):
//   SAAS_INGEST_URL    https://<saas>/api/ingest/x
//   SAAS_INGEST_SECRET = your CRON_SECRET
//   PROXY_SERVER       (already set for screenshots; reused here)
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);
const fs = require("fs");

const SESSION = process.env.X_SESSION_FILE || "/app/data/x-session.json";
const CONFIG = process.env.XFIND_CONFIG || "/app/data/xfind.config.json";
const INGEST_URL = process.env.SAAS_INGEST_URL;
const INGEST_SECRET = process.env.SAAS_INGEST_SECRET;
const PROXY = process.env.PROXY_SERVER;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// A post must contain the title AND one of these to be flagged (keeps mere mentions out).
const KEYWORDS = ["full movie", "full film", "watch", "stream", "streaming", "download", "free", "leaked", "leak", "1080p", "720p", "hd", "online", "link in", "watch now"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const looksPiracy = (title, text) => text.includes(title.toLowerCase()) && KEYWORDS.some((k) => text.includes(k));

async function searchTitle(page, title) {
  const q = encodeURIComponent(`"${title}" (full OR watch OR stream OR download OR leaked OR free)`);
  await page.goto(`https://x.com/search?q=${q}&f=live`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(5000);
  const found = new Map();
  for (let i = 0; i < 6; i++) {
    const items = await page.$$eval("article", (arts) =>
      arts.map((a) => {
        const link = a.querySelector('a[href*="/status/"]');
        return { href: link ? link.href : null, text: a.innerText || "" };
      })
    ).catch(() => []);
    for (const it of items) {
      if (!it.href) continue;
      const m = it.href.match(/https:\/\/(?:x|twitter)\.com\/[^/]+\/status\/\d+/);
      if (m) found.set(m[0], it.text.toLowerCase());
    }
    await page.mouse.wheel(0, 3000);
    await sleep(3000);
  }
  return found;
}

(async () => {
  if (!fs.existsSync(SESSION)) { console.error("No session at", SESSION, "- run xlogin.js locally and upload x-session.json."); process.exit(1); }
  const targets = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  const browser = await chromium.launch({ headless: true, proxy: PROXY ? { server: PROXY } : undefined });
  const ctx = await browser.newContext({ storageState: SESSION, userAgent: UA, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  if (/\/login|\/i\/flow\/login/.test(page.url())) { console.error("Session expired - re-run xlogin.js and re-upload x-session.json."); await browser.close(); process.exit(2); }

  for (const t of targets) {
    try {
      const found = await searchTitle(page, t.title);
      const hits = [...found.entries()].filter(([, text]) => looksPiracy(t.title, text)).map(([url]) => url);
      console.log(`${t.title}: scanned ${found.size}, ${hits.length} candidate(s)`);
      if (hits.length && INGEST_URL) {
        const res = await fetch(`${INGEST_URL}?secret=${INGEST_SECRET}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ titleId: t.titleId, urls: hits }),
        });
        console.log("  ingest:", res.status, (await res.text()).slice(0, 120));
      }
    } catch (e) { console.error(`${t.title}: error`, e.message); }
    await sleep(8000); // gentle pause between titles
  }

  await ctx.storageState({ path: SESSION }); // refresh cookies for next run
  await browser.close();
})();
