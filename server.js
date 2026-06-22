const express = require("express");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);

const app = express();
app.use(express.json());

const SECRET = process.env.SHOT_SECRET;
const FS = process.env.FLARESOLVERR_URL;

const isChallenge = (html) =>
  /just a moment|performing security verification|attention required|cf-browser-verification|challenge-platform|_cf_chl/i.test(html || "");

function proxy() {
  if (!process.env.PROXY_SERVER) return undefined;
  return { server: process.env.PROXY_SERVER, username: process.env.PROXY_USERNAME, password: process.env.PROXY_PASSWORD };
}

async function solveHtml(url) {
  if (!FS) return null;
  try {
    const body = { cmd: "request.get", url, maxTimeout: 60000 };
    // Route FlareSolverr's solver through the residential proxy → real ISP IP
    // + challenge-solving = reliably clears managed Cloudflare.
    if (process.env.PROXY_SERVER) {
      const host = process.env.PROXY_SERVER.replace(/^https?:\/\//, "");
      body.proxy = { url: `http://${process.env.PROXY_USERNAME}:${process.env.PROXY_PASSWORD}@${host}` };
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

  let browser;
  try {
    const solved = await solveHtml(url);
    const haveRealHtml = solved && solved.html && !isChallenge(solved.html) && solved.status !== 403;

    if (haveRealHtml) {
      // Render the solved HTML statically — NO proxy on the render browser
      // (the proxy was only for FlareSolverr's fetch). JS off so it can't drift.
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

    // Live capture fallback (needs the residential proxy to pass managed Cloudflare).
    browser = await chromium.launch({ proxy: proxy(), args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    if (isChallenge(await page.content())) {
      return res.status(422).json({ error: "challenge-not-solved", note: "needs a residential proxy (PROXY_SERVER) to capture this site" });
    }
    const jpg = await page.screenshot({ type: "jpeg", quality: 75, fullPage: true });
    res.set("X-Http-Status", String(resp ? resp.status() : 0));
    return res.type("jpeg").send(jpg);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(process.env.PORT || 8080, () => console.log("render service up; flaresolverr:", !!FS, "proxy:", !!process.env.PROXY_SERVER));
