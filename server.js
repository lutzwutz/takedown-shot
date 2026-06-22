const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

const SECRET = process.env.SHOT_SECRET;
const FS = process.env.FLARESOLVERR_URL;

// FlareSolverr clears Cloudflare (on its own IP) and returns the real HTML.
async function solveHtml(url) {
  if (!FS) return null;
  try {
    const r = await fetch(`${FS.replace(/\/$/, "")}/v1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 60000 }),
      signal: AbortSignal.timeout(80000),
    });
    if (!r.ok) return null;
    const sol = (await r.json()).solution;
    return sol ? { html: sol.response || "", status: sol.status || 200 } : null;
  } catch {
    return null;
  }
}

app.get("/healthz", (_req, res) => res.send("ok"));

// POST /shot { url } -> downscaled full-page JPEG. Renders the FlareSolverr HTML
// statically (JS disabled) with a <base> tag so CSS/images resolve. No live
// re-hit of Cloudflare, no proxy, no per-shot fee.
app.post("/shot", async (req, res) => {
  if (SECRET && req.headers["x-secret"] !== SECRET) return res.status(401).json({ error: "unauthorized" });
  const url = req.body && req.body.url;
  if (!url) return res.status(400).json({ error: "url required" });

  let browser;
  try {
    const solved = await solveHtml(url);
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    // JS disabled: render the captured HTML statically (no re-challenge / drift).
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: !solved });
    const page = await ctx.newPage();
    let httpStatus = 0;

    if (solved && solved.html) {
      httpStatus = solved.status;
      const origin = new URL(url).origin;
      const html = /<base\b/i.test(solved.html)
        ? solved.html
        : solved.html.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/">`);
      await page.setContent(html, { waitUntil: "load", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);
    } else {
      // Fallback for non-Cloudflare sites: navigate live.
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      httpStatus = resp ? resp.status() : 0;
      await page.waitForTimeout(1500);
    }

    const jpg = await page.screenshot({ type: "jpeg", quality: 75, fullPage: true });
    res.set("X-Http-Status", String(httpStatus));
    res.type("jpeg").send(jpg);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(process.env.PORT || 8080, () => console.log("render service up; flaresolverr:", !!FS));
