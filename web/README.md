# web — Qanawat Concierge frontend

Rebranded fork of [`livekit/agents-playground`](https://github.com/livekit/agents-playground)
(Apache-2.0 — see `LICENSE` / `NOTICE`). Next.js 15, pages router. Also hosts the
`POST /api/token` LiveKit token endpoint.

## Local dev

```bash
cp .env.example .env.local     # fill in LIVEKIT_* + NEXT_PUBLIC_LIVEKIT_URL
pnpm install
pnpm dev                       # http://localhost:3000
```

## Qanawat changes vs upstream

| File | Change |
|---|---|
| `src/hooks/useConfig.tsx` | `defaultConfig` → Qanawat title/description, `theme_color: "qanawat"`, `video_fit: "cover"` |
| `tailwind.config.js` | added the `qanawat` brand-maroon color ramp (`#c91852` / `#9e1240` / `#6e0d2c`) |
| `src/pages/index.tsx` | pass Qanawat `/logo.svg` to the header; `qanawat` first in the color picker; dropped LiveKit og:image |
| `src/components/playground/PlaygroundHeader.tsx` | logo links to `qanawat.ai` |
| `public/logo.svg`, `public/favicon.ico` | Qanawat brand assets |
| `next.config.js` | `output: "standalone"` + `outputFileTracingRoot` for the Docker image |
| `src/lib/types.ts`, `src/components/debug/event-log.tsx` | cover new `SessionEventType` members (upstream type fix) |

Branding can also be overridden at deploy time with a one-line `NEXT_PUBLIC_APP_CONFIG`
(see `../deploy/.env.example`).
