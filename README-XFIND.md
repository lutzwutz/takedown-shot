# X-finder (operator tool)

Low-frequency, logged-in search of X for piracy posts. **Operator tool only** —
run it for the titles you personally handle; it is not a customer-facing feature
(it relies on a burner session and X scraping, which doesn't scale across tenants).
It only *finds + posts candidates for review* — it never files a takedown.

## One-time setup

### 1. Burner X account
Create a throwaway X account (not your real one). If X ever flags automation, you
lose only the burner.

### 2. Capture its session (on your LOCAL machine, not the VPS)
```bash
cd takedown-shot
npm install
node xlogin.js          # opens a browser → log into the burner → press Enter
```
This writes `x-session.json`.

### 3. Upload the session + config to the VPS
```bash
mkdir -p ~/takedown-shot/data
# copy x-session.json into ~/takedown-shot/data/x-session.json
```
Create `~/takedown-shot/data/xfind.config.json`:
```json
[
  { "titleId": "cmqo8aqkk000us60eg9s2w02r", "title": "Citizen Vigilante" }
]
```
(`titleId` is in the dashboard title URL.)

### 4. Add the ingest env to the VPS `.env`
```
SAAS_INGEST_URL=https://takedown-guard-site-366778139901.us-central1.run.app/api/ingest/x
SAAS_INGEST_SECRET=<your CRON_SECRET>
```
Then rebuild: `docker compose up -d --build`

## Run it (low frequency)
```bash
docker compose exec -T render node xfind.js
```
Candidates land in the dashboard under the title's `x.com` group as **"new"**
(source `x-finder`) for you to review before filing.

Suggested cron (3×/day = low and slow):
```
0 7,15,23 * * * cd ~/takedown-shot && docker compose exec -T render node xfind.js >> /var/log/xfind.log 2>&1
```

## Notes
- X's search DOM + anti-bot change often; the `article` scraping may need tuning
  after the first real run (same iteration we did for the screenshot service).
- Keep frequency low and the run gentle — that's what keeps the burner alive.
