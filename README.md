# takedown-shot — self-hosted proof capture

Playwright (with stealth) routed through a **residential proxy** to screenshot
Cloudflare-protected pages. Runs on your fixed-price VPS so per-shot cost is just
proxy bandwidth (~€0.001–0.005/shot via DataImpulse/Webshare at ~$1/GB), instead
of a per-call scraping API.

## Deploy on the VPS

```bash
# Node 20+
git clone / copy this folder, then:
npm install
npx playwright install --with-deps chromium

# env
export SHOT_SECRET=<long-random-string>          # shared with the SaaS
export PROXY_SERVER=http://gw.dataimpulse.com:823 # your residential proxy gateway
export PROXY_USERNAME=<proxy-user>
export PROXY_PASSWORD=<proxy-pass>
export PORT=8080

# run (use pm2 or a systemd unit to keep it alive)
npm start
# or: pm2 start server.js --name takedown-shot
```

Put it behind HTTPS (Caddy/nginx) or restrict the port to the SaaS. The
`SHOT_SECRET` header gates access.

## Point the SaaS at it
Set in the SaaS (Cloud Run) env:
```
SHOT_SERVICE_URL=https://shot.your-vps-domain
SHOT_SECRET=<same as above>
```
When `SHOT_SERVICE_URL` is set, the SaaS captures proof via this service; otherwise
it falls back to ScrapingBee. The SaaS uploads the returned PNG to its GCS bucket.

## API
`POST /shot` with header `x-secret: <SHOT_SECRET>`, body `{ "url": "https://…" }`
→ returns the full-page PNG (and an `X-Http-Status` header).

## Docker (optional)
A `Dockerfile` is included if you prefer containers on the VPS.
