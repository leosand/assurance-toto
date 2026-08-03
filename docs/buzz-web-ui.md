# Buzz Web UI — What Works & The "Open in Buzz" Button

> Status : verified 2026-08-03 against the running stack (Buzz relay `ghcr.io/block/buzz:main`, health on `:8081`, web UI on `:3002`).

## Quick answer

- **`http://localhost:3002/`** is the **Nostr relay API endpoint** — it serves the NIP-11 document (JSON) and the WebSocket protocol. Opening it in a browser shows JSON. That is expected behavior.
- **`http://localhost:3002/repos`** is the **web UI** served by the relay (SPA). It currently shows the **"Repositories"** view (the relay's git-web-GUI bundle). It loads and renders correctly (verified with Edge headless: `<title>Buzz</title>`, "Repositories" visible).
- The **"Open in Buzz"** button inside that web UI is a **deep link** (`buzz://connect?relay=...` / `buzz://join?...`) designed to open the **Buzz desktop application** (Tauri). In a plain browser without that app installed, the link is ignored — hence "nothing happens". This is native upstream behavior of Buzz, **not** a bug in this project.

## What is the demo interface for Assurance Toto then?

| Surface | URL | Role in the demo |
|---|---|---|
| **CEO cockpit** (recommended) | http://localhost:3100/dashboard | The investor-facing UI : P&L, ratio, approvals, audit timeline, kill-switch. Includes a header link **"Open Buzz workspace (Nostr) ↗"**. |
| Buzz relay API | http://localhost:8081 | Health/liveness/readiness of the Nostr relay. |
| Buzz web UI (repos view) | http://localhost:3002/repos | Shows the relay is alive and serving its SPA. The full workspace (channels, messages) lives in the **Buzz desktop app** (`buzz://`). |
| Bridge API | http://localhost:3100 | `/commands`, `/approvals`, `/metrics`, `/healthz`, `/readyz`. |

## Why this is fine for the demo

- The **CEO cockpit is the primary demo surface** — it is our own product, fully controlled, in English, and reads live from Postgres.
- **Buzz provides the identity/audit layer** : every agent and the CEO have Nostr keypairs, decisions are signed (NIP-98 / kind-27235), and the relay validates them. We demonstrate Buzz through its API and through the signed-decision flow, not through its desktop UI.
- Installing the **Buzz desktop app** (`https://github.com/block/buzz/releases`) unlocks the full channel workspace against the same relay at `ws://localhost:3002` if you want the richer UX.

## Verified commands

```bash
# Relay alive
curl -s http://localhost:8081/_liveness      # ok
curl -s http://localhost:8081/_readiness     # {"status":"ready"}

# Web UI served
curl -s -o /dev/null -w '%{http_code} %{content_type}' http://localhost:3002/repos
# 200 text/html; charset=utf-8

# API endpoint (NIP-11) — JSON, by design
curl -s http://localhost:3002/ | head -c 120

# CEO cockpit (main demo surface)
curl -s http://localhost:3100/dashboard | grep -o 'Open Buzz workspace[^<]*'
```
