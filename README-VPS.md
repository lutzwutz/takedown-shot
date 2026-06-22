# Takedown Guard — VPS proof service

Runs **FlareSolverr** (Cloudflare solver) + the **render service** (screenshot →
JPEG). FlareSolverr solves from the VPS's fixed IP, which you whitelist in
DataImpulse, so it can use the residential proxy without broken auth.

## One-time setup (~10 min)

1. **Get a small VPS** (Hetzner CX22 ~€4/mo, or DigitalOcean). Note its IPv4.
2. **Whitelist that IPv4 in DataImpulse** → dashboard → *Manage Whitelist IPs* → add it.
   (This lets FlareSolverr use `gw.dataimpulse.com:823` with no username/password.)
3. **Install Docker** on the VPS:
   ```
   curl -fsSL https://get.docker.com | sh
   ```
4. **Copy this folder** to the VPS (e.g. `scp -r takedown-shot root@VPS_IP:/opt/`).
5. **Set a shared secret** and start it:
   ```
   cd /opt/takedown-shot
   echo "SHOT_SECRET=$(openssl rand -hex 16)" > .env
   docker compose up -d --build
   ```
6. **Open port 8080** (`ufw allow 8080` or your provider's firewall).
7. **Test** from your laptop:
   ```
   curl -X POST http://VPS_IP:8080/shot -H "x-secret: <the secret>" \
     -H "content-type: application/json" \
     -d '{"url":"https://ext.to/citizen-vigilante-m190836/"}' -o proof.jpg
   ```
   You should get a real screenshot (not a 422 / challenge page).

## Then send me
- The render URL: `http://VPS_IP:8080`
- The `SHOT_SECRET` value

I'll set `SHOT_SERVICE_URL` + `SHOT_SECRET` on the SaaS, and proof-capture goes
fully live for fortress sites too — self-hosted, ~$0.002/shot.

> Production hardening (later): put it behind HTTPS (Caddy/Traefik) and restrict
> port 8080 to the SaaS egress IP.
