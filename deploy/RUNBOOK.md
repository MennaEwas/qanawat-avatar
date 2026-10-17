# Qanawat Concierge — deployment runbook

Target: `https://avatar.qanawat.ai` on the existing server
(`ubuntu@erp.qanawat.ai`, `65.108.212.238`, Docker host that already runs Odoo).

Two containers: `web` (Next.js UI + `/api/token`) on `127.0.0.1:3002`, and `agent`
(Python LiveKit worker, outbound only). Host nginx terminates TLS and proxies to `web`.

---

## 1. One-time prerequisites (do these first)

### 1a. LiveKit Cloud project
1. Sign up at https://cloud.livekit.io (free tier is enough to start).
2. Create a project (pick the `Middle East` / closest region).
3. Project → **Settings → Keys** → create a key. Copy three values:
   - Project URL — `wss://<something>.livekit.cloud`
   - API Key — `API...`
   - API Secret
4. LiveKit **Inference** (the built-in STT/LLM/TTS gateway) is enabled by default on
   Cloud projects — no extra keys. Usage is billed to the LiveKit project.

### 1b. DNS
Add an A record in the `qanawat.ai` zone (GoDaddy):

```
avatar   A   65.108.212.238     (TTL 600)
```

Verify before continuing: `dig +short avatar.qanawat.ai` → `65.108.212.238`.

---

## 2. Ship the code to the server

From this machine (`C:\Users\shaym\codes`):

```bash
scp -r qanawat-playground ubuntu@erp.qanawat.ai:/home/ubuntu/
```

(or push the folder to a git repo and `git clone` it on the server.)

---

## 3. Configure and start the stack

> Shortcut: after step 3's `cp .env.example .env` + editing it, you can run
> `bash deploy.sh` from `deploy/` to do steps 3–4 automatically. Manual steps below.

SSH in and create the env file:

```bash
ssh ubuntu@erp.qanawat.ai
cd /home/ubuntu/qanawat-playground/deploy
cp .env.example .env
nano .env        # paste the 3 values from step 1a
```

Build and run:

```bash
docker compose up -d --build
docker compose ps
curl -I http://127.0.0.1:3002        # expect HTTP/1.1 200 OK
docker compose logs -f agent         # expect "registered worker" / "connected to LiveKit"
```

---

## 4. nginx vhost + TLS

Check how the server fronts the other sites (host nginx is expected):

```bash
sudo nginx -T | grep -E "server_name|listen" | grep -i qanawat
```

If host nginx serves `qanawat.ai` / `erp.qanawat.ai` (sites-available), install the vhost:

```bash
cd /home/ubuntu/qanawat-playground/deploy
sudo cp avatar.qanawat.ai.nginx /etc/nginx/sites-available/avatar.qanawat.ai
sudo ln -s /etc/nginx/sites-available/avatar.qanawat.ai /etc/nginx/sites-enabled/
# ensure the ws upgrade map exists (harmless if added once):
echo 'map $http_upgrade $connection_upgrade { default upgrade; "" close; }' | \
  sudo tee /etc/nginx/conf.d/ws_upgrade.conf
sudo nginx -t && sudo systemctl reload nginx
```

Issue the certificate:

```bash
sudo certbot --nginx -d avatar.qanawat.ai
```

If the other sites are instead behind a dockerised proxy (nginx-proxy / Traefik /
Caddy), add an equivalent route to `127.0.0.1:3002` (or attach `web` to that proxy's
network) rather than using the host-nginx file.

---

## 5. Verify end to end

1. Open `https://avatar.qanawat.ai` — valid cert, Qanawat logo + maroon accent,
   title "Qanawat Concierge — Voice Test", no GitHub icon.
2. Click **Connect** → status goes `Connected`; within ~5 s the Agent section shows an
   identity and "Agent connected". Cross-check `docker compose logs agent`.
3. Allow the mic, say *"What does Qanawat do?"* → you hear a spoken reply and see both
   sides of the transcript in the **Chat** tab.
4. Say *"I'd like a demo"* → the agent takes your first name + interest and directs you
   to book at `qanawat.ai/book`.
5. LiveKit Cloud dashboard → the project shows the room, 2 participants, and inference
   usage.

---

## 6. Updating later

```bash
cd /home/ubuntu/qanawat-playground
git pull            # or re-scp
cd deploy
docker compose up -d --build
```

Agent-only change: `docker compose up -d --build agent`.

## 7. Operations

- Logs: `docker compose logs -f web` / `... agent`
- Restart: `docker compose restart agent`
- Stop everything: `docker compose down`
- The agent auto-scales by process concurrency; for more load run
  `docker compose up -d --scale agent=2`.

## Troubleshooting

| Symptom | Check |
|---|---|
| "Connected" but no agent joins | `docker compose logs agent` — worker registered? `LIVEKIT_URL` correct (wss, no trailing slash)? key/secret match the same project? |
| Agent joins, silent | Inference errors in agent logs; confirm the project has Inference/billing enabled |
| Page loads but Connect fails 500 | `docker compose logs web` — `LIVEKIT_API_KEY/SECRET` present in `web` env |
| Mic blocked | site must be HTTPS (step 4) and the browser must grant mic permission |
| Wrong LiveKit URL after change | `NEXT_PUBLIC_LIVEKIT_URL` is baked at build — re-run `up -d --build` after editing `.env` |
