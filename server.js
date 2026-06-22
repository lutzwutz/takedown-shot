const express = require("express");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);

const app = express();
app.use(express.json());

const SECRET = process.env.SHOT_SECRET;
const FS = process.env.FLARESOLVERR_URL;

// Match only the actual interstitial challenge PAGE — not the Cloudflare
// challenge-platform script that's referenced on every CF-served page (which
// caused solved pages to be misread as challenges).
const isChallenge = (html) =>
  /just a moment\.\.\.|performing security verification|checking your browser before|verif(y|ying) you are (a )?human|attention required![\s\S]{0,60}cloudflare/i.test(html || "");

function proxy() {
  if (!process.env.PROXY_SERVER) return undefined;
  return { server: process.env.PROXY_SERVER, username: process.env.PROXY_USERNAME, password: process.env.PROXY_PASSWORD };
}

// FlareSolverr solves the challenge. If an IP-whitelisted (no-auth) residential
// proxy is configured, route the solve through it → real IP → reliably clears
// managed Cloudflare. (FlareSolverr can't use *authenticated* proxies, hence the
// IP-whitelist requirement — give it a fixed IP and whitelist it in DataImpulse.)
async function solveHtml(url) {
  if (!FS) return null;
  try {
    const body = { cmd: "request.get", url, maxTimeout: 60000 };
    if (process.env.PROXY_SERVER && !process.env.PROXY_USERNAME) {
      const s = process.env.PROXY_SERVER;
      body.proxy = { url: s.startsWith("http") ? s : `http://${s}` };
    }
    const r = await fetch(`${FS.replace(/\/$/, "")}/v1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) return null;
    const sol = (await r.json()).solution;
    return sol ? { html: sol.response || "", status: sol.status || 200 } : null;
  } catch {
    return null;
  }
}

app.get("/healthz", (_req, res) => res.send("ok"));

// POST /shot { url } -> downscaled full-page JPEG, or 422 if we can't get the
// real page (we refuse to return a Cloudflare challenge screen as "proof").
// Strategy: FlareSolverr HTML (free) -> if challenge & a residential PROXY is
// configured, navigate live through it (reliable) -> else fail honestly.
app.post("/shot", async (req, res) => {
  if (SECRET && req.headers["x-secret"] !== SECRET) return res.status(401).json({ error: "unauthorized" });
  const url = req.body && req.body.url;
  if (!url) return res.status(400).json({ error: "url required" });

  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  let browser;
  try {
    // 1. FlareSolverr solve (uses the no-auth/IP-whitelisted residential proxy if
    //    set) -> static render. This is the reliable VPS path for managed Cloudflare.
    const solved = await solveHtml(url);
    if (solved && solved.html && !isChallenge(solved.html) && solved.status !== 403) {
      browser = await chromium.launch({ args: ["--no-sandbox"] });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false });
      const page = await ctx.newPage();
      const origin = new URL(url).origin;
      const html = /<base\b/i.test(solved.html) ? solved.html : solved.html.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/">`);
      await page.setContent(html, { waitUntil: "load", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const jpg = await page.screenshot({ type: "jpeg", quality: 75, fullPage: true });
      res.set("X-Http-Status", String(solved.status));
      return res.type("jpeg").send(jpg);
    }

    // 2. Authenticated-proxy fallback (Cloud Run, no IP whitelist): live navigate
    //    through the proxy with Playwright (it handles auth) + poll for clearance.
    if (process.env.PROXY_SERVER && process.env.PROXY_USERNAME) {
      browser = await chromium.launch({ proxy: proxy(), args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", userAgent: UA });
      const page = await ctx.newPage();
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      for (let i = 0; i < 10; i++) {
        if (!isChallenge(await page.content().catch(() => ""))) break;
        await page.waitForTimeout(2500);
      }
      if (isChallenge(await page.content().catch(() => ""))) return res.status(422).json({ error: "challenge-not-solved" });
      const jpg = await page.screenshot({ type: "jpeg", quality: 75, fullPage: true });
      res.set("X-Http-Status", String(resp ? resp.status() : 0));
      return res.type("jpeg").send(jpg);
    }

    // 3. Honest failure — never return a challenge screen as proof.
    return res.status(422).json({ error: "challenge-not-solved" });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(process.env.PORT || 8080, () => console.log("render service up; flaresolverr:", !!FS, "proxy:", !!process.env.PROXY_SERVER));
