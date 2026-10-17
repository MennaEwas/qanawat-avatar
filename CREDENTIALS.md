# Qanawat Avatar — package contents (CONFIDENTIAL)

This package contains live keys. Keep it private; do not commit it to git or share it.

## What's here

| Path | Contents |
| --- | --- |
| `agent/` | Voice agent (Python, LiveKit Agents) |
| `web/` | Website, admin panel, doctor bio page (Next.js) |
| `deploy/` | Self-hosting: Docker Compose, nginx, runbooks |
| `docs/Qanawat-Avatar-Technical-Documentation.docx` | Full technical documentation |
| `docs/Qanawat-Avatar-Server-Specifications.docx` | Server specifications and hosting options for the client |
| `voice-samples/` | The same Arabic sentence in each candidate voice (Walid is in use) |
| `mcp.js` | Reference copy of the hospital's MCP server source |

## Credentials

| File | Contains |
| --- | --- |
| `agent/src/.env.local` | LiveKit URL/key/secret, alexa360 key, HeyGen LiveAvatar key + avatar ID, WhatsApp access token + phone number ID, hospital servers (new `salemavatar` MCP + API key, legacy `salemmcp` fallback, REST API base + key), voice/model defaults, hotline |
| `web/.env.local` | LiveKit URL/key/secret, Vercel Blob token, admin password (`ADMIN_PASSWORD`) and cookie secret |
| `agent/livekit.toml` | LiveKit Cloud project (`avatar-fh5ke1ry`) and agent ID (`CA_KwabQkDMqSWH`) |
| `*/.env.example` | Templates listing every setting, without values |

Hospital servers (as configured on 2026-10-15):

- Main: `https://salemavatar.alsalamhosp.com/mcp` (key `ALSALAM_MCP_API_KEY`, header `X-API-Key`)
- REST API: `https://salemavatar.alsalamhosp.com/api` (key `ALSALAM_RAW_API_KEY`)
- Fallback + OTP: `https://salemmcp.alsalamhosp.com/mcp` (no key) — OTP always; patient lookup, booking and confirmation only when the new server refuses access

## Run locally

Dependencies are not included (about 1.3 GB, platform-specific); these commands install them.

1. Web: `cd web && pnpm install && pnpm dev` → http://localhost:3000 (admin at /admin)
2. Agent: `cd agent && uv sync && uv run src/agent.py dev`

Running the agent locally registers it as `alsalam-concierge`, the live cloud agent's name, so it can receive live calls. For testing, set `AGENT_NAME=alsalam-test` for both web and agent.

## Status (2026-10-15)

Live: the agent and website as of 2026-10-12. Not yet live: admin panel and per-screen settings, code-level OTP lock, Arabic chat alignment, new-server migration with fallback.
