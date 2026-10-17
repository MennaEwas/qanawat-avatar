# Deploy without the Odoo server (serverless path)

Frontend → **Vercel**. Agent → **LiveKit Cloud** (LiveKit hosts it). No `erp.qanawat.ai`
involvement. The only infra you own is one LiveKit Cloud project.

## 0. LiveKit Cloud project  (only step that needs you — ~2 min)

1. https://cloud.livekit.io → **Sign in with Google** (no new account/password).
2. A project is created automatically. **Settings → Keys** — a default key already exists.
3. Copy three values:
   - Project URL  `wss://<subdomain>.livekit.cloud`
   - API Key      `API…`
   - API Secret

## 1. Agent → LiveKit Cloud

```bash
cd qanawat-playground/agent
# put LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET in .env.local
pip install livekit-cli        # or: brew install livekit-cli
lk cloud auth                  # opens browser, links the project
lk agent create               # builds the Dockerfile, deploys, fills livekit.toml
```
LiveKit now runs the concierge worker. `lk agent logs` to watch it.

## 2. Frontend → Vercel

```bash
cd qanawat-playground/web
npm i -g vercel
vercel                        # link / create project, first deploy
vercel env add NEXT_PUBLIC_LIVEKIT_URL      # wss://<subdomain>.livekit.cloud
vercel env add LIVEKIT_API_KEY
vercel env add LIVEKIT_API_SECRET
vercel --prod                 # redeploy with env
```
You get `https://<something>.vercel.app` — already fully working (talk to the concierge).

## 3. (optional) Put it on avatar.qanawat.ai

In Vercel: **Project → Settings → Domains → add `avatar.qanawat.ai`**. Vercel shows a
DNS target (a CNAME or an A record). In GoDaddy DNS for `qanawat.ai`:

- **change** the `avatar` A record (currently `65.108.212.238`) to what Vercel tells you
  (usually `CNAME avatar → cname.vercel-dns.com`, or an A record to `76.76.21.21`).

This is another GoDaddy change (2FA again). Until then, just use the `.vercel.app` URL.

## Cost
LiveKit Cloud free tier + Vercel Hobby = $0 for demo-level traffic. LiveKit Inference
(STT/LLM/TTS) is metered — a few dollars per hour of conversation.
