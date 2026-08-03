# Buzz Web UI — What Works & The "Open in Buzz" Button

> Status: verified 2026-08-03 with the running local stack (Buzz relay `ghcr.io/block/buzz:main`, health on :8081, web UI on :3002).

## Quick answer

- `http://localhost:3002/` — **Buzz Nostr relay API endpoint**. It serves a NIP-11-info JSON doc and accepts WebSocket. Offering it in a browser shows JSON — that is intentional.
- `http://localhost:3002/repos` — **Buzz web UI** (SPA, Vite build). It loads the "Repositories" view (the relay's git/web-GUI bundle). Verified with Edge headless: `<title>Buzz</title>` and a "Repositories" button render.
- "**Open in Buzz**" inside that web UI is a **deep link** (`buzz://connect?relay=...`) designed to hand off to the **Buzz desktop app (Tauri)**. If the desktop app isn't installed, nothing sensible happens — this is upstream behavior, not a bug in this project.

## What is the demo interface for Assurance Toto?

| Surface | URL | Role in demo |
|---|---|---|
| **CEO cockpit (recommended)** | http://localhost:3100/dashboard | Investor-facing UI : P&L, ratio, approvals, audit timeline, kill-switch. Links to "Open Buzz workspace (Nostr) ↗". |
| Buzz relay API | http://localhost:8081 | Health/liveness/readiness of the Nostr relay. |
| Buzz relay SPA | http://localhost:3002/repos | Confirms the relay serves its web bundle; the full channel workspace lives in the Buzz desktop app (`buzz://connect?relay=ws://localhost:3002`). |
| Bridge API | http://localhost:3100 | `/commands`, `/approvals`, `/metrics`, `/healthz`, `/readyz`. |

## Why this is fine for the demo

- The **CEO cockpit is the primary demo surface** — it is our product, fully controlled, in English, and reads live from Postgres.
- **Buzz provides identity + audit** : every agent/CEO has a Nostr keypair, decisions are Schnorr-signed (kind 27235), and the relay validates them. The important part is the signed-decision flow and the hash-chained audit, not the desktop chat UX.
- Installing the **Buzz desktop app** ([releases](https://github.com/block/buzz/releases)) unlocks the full channel workspace against the same relay at `ws://localhost:3002` if you want the richer native UX.

## Verified commands

```bash
# Relay alive
curl -s http://localhost:8081/_liveness        # ok
curl -s http://localhost:8081/_readiness       # {"status":"ready"}

# Web UI served
curl -s -o /dev/null -w '%{http_code} %{content_type}' http://localhost:3002/repos
# 200 text/html; charset=utf-8

# API endpoint (NIP-11) — JSON, by design
curl -s http://localhost:3002/ | head -c 120

# CEO cockpit (main demo surface)
curl -s http://localhost:3100/dashboard | grep 'Open Buzz workspace'
```
