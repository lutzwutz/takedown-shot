// YouTube finder — runs on the VPS:  docker compose exec -T render node ytfind.js
// YouTube search is public (no login/burner), so this just searches for each title
// and flags likely FULL-MOVIE uploads (title match + long runtime, or "full movie"
// in the title). Posts candidates to the SaaS for review — never files anything.
//
// Reuses data/xfind.config.json ([{ titleId, title }]) and the same ingest env.
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);
const fs = require("fs");

const CONFIG = process.env.XFIND_CONFIG || "/app/data/xfind.config.json";
const INGEST_URL = process.env.SAAS_INGEST_URL;
const SECRET = process.env.SAAS_INGEST_SECRET;
const PROXY = process.env.PROXY_SERVER;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pull the current title list from the app (so re-adding a title can't break us);
// fall back to the local config file if the endpoint is unavailable.
async function loadTargets() {
  if (INGEST_URL && SECRET) {
    try {
      const r = await fetch(`${INGEST_URL.replace(/\/x$/, "/titles")}?secret=${SECRET}`);
      if (r.ok) { const d = await r.json(); if (Array.isArray(d.titles) && d.titles.length) return d.titles; }
    } catch { /* fall back */ }
  }
  try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { return []; }
}

function durMins(t) { // "1:42:30" -> 102, "12:05" -> 12
  if (!t) return 0;
  const p = t.trim().split(":").map(Number);
  if (p.some(isNaN)) return 0;
  if (p.length === 3) return p[0] * 60 + p[1];
  if (p.length === 2) return p[0];
  return 0;
}

async function searchYT(page, title) {
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} full movie`)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3000);
  if (/consent\./.test(page.url())) { // EU consent gate
    await page.click('button[aria-label*="Accept"], button[aria-label*="Reject"], form button').catch(() => {});
    await sleep(2500);
  }
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 3000); await sleep(1500); }
  return page.$$eval("ytd-video-renderer", (els) =>
    els.map((e) => {
      const a = e.querySelector("a#video-title");
      const dur = e.querySelector("span.ytd-thumbnail-overlay-time-status-renderer, #time-status #text");
      return { href: a ? a.href : null, title: (a ? (a.getAttribute("title") || a.textContent || "") : "").trim(), dur: dur ? dur.textContent.trim() : "" };
    })
  ).catch(() => []);
}

(async () => {
  const targets = await loadTargets();
  if (!targets.length) { console.error("no titles to scan"); return; }
  const browser = await chromium.launch({ headless: true, proxy: PROXY ? { server: PROXY } : undefined });
  const ctx = await browser.newContext({ userAgent: UA, locale: "en-US", extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" } });
  const page = await ctx.newPage();
  for (const t of targets) {
    try {
      const items = (await searchYT(page, t.title)).filter((it) => it.href);
      const tl = t.title.toLowerCase();
      const urls = Array.from(new Set(
        items.filter((it) => {
          const title = it.title.toLowerCase();
          if (!title.includes(tl)) return false;
          return durMins(it.dur) >= 45 || title.includes("full movie") || title.includes("full film");
        }).map((it) => it.href.split("&")[0])
      ));
      console.log(`${t.title}: ${items.length} videos, ${urls.length} full-movie candidate(s)`);
      if (urls.length && INGEST_URL) {
        const res = await fetch(`${INGEST_URL}?secret=${SECRET}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ titleId: t.titleId, urls, source: "yt-finder" }),
        });
        console.log("  ingest:", res.status, (await res.text()).slice(0, 120));
      }
    } catch (e) { console.error(`${t.title}: error`, e.message); }
    await sleep(5000);
  }
  await browser.close();
})();
