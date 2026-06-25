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
// Strong phrases = piracy on their own. Weak ones only count if the post also links out.
const STRONG = ["full movie", "full film", "watch online", "watch free", "stream free", "free movie", "download", "leaked", "link in bio", "link in replies", "dm for", "telegram", "watch now"];
const WEAK = ["watch", "stream", "streaming", "online", "free", "hd", "1080p", "720p"];
// Legit-chatter signals — if present, skip (trailers, reviews, theatrical talk).
const NEGATIVE = ["trailer", "teaser", "theaters", "theatres", "cinema", "review", "interview", "premiere", "tickets", "box office", "can't wait", "cant wait", "release date", "official trailer", "red carpet"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function looksPiracy(title, text, hasLink) {
  if (!text.includes(title.toLowerCase())) return false;
  if (NEGATIVE.some((n) => text.includes(n))) return false;
  if (STRONG.some((k) => text.includes(k))) return true;
  return hasLink && WEAK.some((k) => text.includes(k)); // weak signal needs an outbound link
}

async function searchTitle(page, title) {
  const q = encodeURIComponent(`"${title}" (full OR watch OR stream OR download OR leaked OR free)`);
  await page.goto(`https://x.com/search?q=${q}&f=live`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(5000);
  const found = new Map();
  for (let i = 0; i < 6; i++) {
    const items = await page.$$eval("article", (arts) =>
      arts.map((a) => {
        const link = a.querySelector('a[href*="/status/"]');
        const ext = a.querySelector('a[href*="t.co/"], a[href^="http"]:not([href*="x.com"]):not([href*="twitter.com"])');
        return { href: link ? link.href : null, text: a.innerText || "", hasLink: !!ext };
      })
    ).catch(() => []);
    for (const it of items) {
      if (!it.href) continue;
      const m = it.href.match(/https:\/\/(?:x|twitter)\.com\/[^/]+\/status\/\d+/);
      if (m) found.set(m[0], { text: it.text.toLowerCase(), hasLink: it.hasLink });
    }
    await page.mouse.wheel(0, 3000);
    await sleep(3000);
  }
  return found;
}

// Pull the current title list from the app (so re-adding a title can't break us);
// fall back to the local config file if the endpoint is unavailable.
async function loadTargets() {
  if (INGEST_URL && INGEST_SECRET) {
    try {
      const r = await fetch(`${INGEST_URL.replace(/\/x$/, "/titles")}?secret=${INGEST_SECRET}`);
      if (r.ok) { const d = await r.json(); if (Array.isArray(d.titles) && d.titles.length) return d.titles; }
    } catch { /* fall back */ }
  }
  try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { return []; }
}

(async () => {
  if (!fs.existsSync(SESSION)) { console.error("No session at", SESSION, "- run xlogin.js locally and upload x-session.json."); process.exit(1); }
  const targets = await loadTargets();
  if (!targets.length) { console.error("no titles to scan"); process.exit(1); }
  const browser = await chromium.launch({ headless: true, proxy: PROXY ? { server: PROXY } : undefined });
  const ctx = await browser.newContext({ storageState: SESSION, userAgent: UA, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  if (/\/login|\/i\/flow\/login/.test(page.url())) { console.error("Session expired - re-run xlogin.js and re-upload x-session.json."); await browser.close(); process.exit(2); }

  for (const t of targets) {
    try {
      const found = await searchTitle(page, t.title);
      const hits = [...found.entries()].filter(([, v]) => looksPiracy(t.title, v.text, v.hasLink)).map(([url]) => url);
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
