const express = require("express");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);

const app = express();
app.use(express.json());

const SECRET = process.env.SHOT_SECRET;

// Residential proxy (DataImpulse / Webshare) — the residential IP is what lets a
// real browser pass Cloudflare and screenshot in the same session.
function proxy() {
  if (!process.env.PROXY_SERVER) return undefined;
  return { server: process.env.PROXY_SERVER, username: process.env.PROXY_USERNAME, password: process.env.PROXY_PASSWORD };
}

app.get("/healthz", (_req, res) => res.send("ok"));

// POST /shot { url } -> full-page PNG (+ X-Http-Status header).
app.post("/shot", async (req, res) => {
  if (SECRET && req.headers["x-secret"] !== SECRET) return res.status(401).json({ error: "unauthorized" });
  const url = req.body && req.body.url;
  if (!url) return res.status(400).json({ error: "url required" });

  let browser;
  try {
    browser = await chromium.launch({ proxy: proxy(), args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "en-US" });
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    // Give a Cloudflare JS challenge time to clear (residential IP usually passes).
    await page.waitForTimeout(6000);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    const png = await page.screenshot({ fullPage: true });
    res.set("X-Http-Status", String(resp ? resp.status() : 0));
    res.type("png").send(png);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(process.env.PORT || 8080, () => console.log("takedown-shot up on", process.env.PORT || 8080, "proxy:", !!process.env.PROXY_SERVER));
