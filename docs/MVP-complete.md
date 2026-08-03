# Assurance Toto — MVP Complete (deliverable)

> Status : **DELIVERED** — verified 2026-08-03 on Windows 11 + WSL2 + Docker Desktop + Ollama host.
> All checks green : stack up, tests pass, E2E workflow proven, Buzz workspace provisioned.

---

## What is included (MVP complete)

A fully operational **AI-operated digital car insurance twin** :

| Layer | Component | Status |
|---|---|---|
| **CEO cockpit** | Lean dashboard served by the bridge | ✅ live (HTTP 200, English, live Postgres reads) |
| **Workspace** | Buzz relay (`ghcr.io/block/buzz:main`) | ✅ live (`:3002` API/UI, `:8081` health) |
| **Workspace CLI** | Buzz desktop install (v0.5.4) + `buzz.exe` CLI | ✅ installed, connected to local relay |
| **Channels** | 12 business channels + welcome message | ✅ provisioned, signed by CEO key |
| **Brain** | Hermes runtime (TypeScript, 8 agents) | ✅ 19/19 tests, tool-calling Ollama |
| **Policy** | buzz-hermes-bridge (Fastify) | ✅ 56/56 tests, anti-forgery, idempotency |
| **Data** | Postgres 16 + PGVector, schema v2 | ✅ 120 clients / 200 contracts / 64 claims / 458 P&L rows |
| **Audit** | Append-only hash-chained log | ✅ `/audit/verify` → `{"ok":true}` |
| **PII** | Presidio anonymization | ✅ running before LLM |
| **LLM** | Ollama host (`gemma4:e4b` + `nomic-embed-text`) | ✅ 9 models loaded |

---

## Interfaces (open these)

| Surface | URL | Purpose |
|---|---|---|
| **CEO cockpit** | http://localhost:3100/dashboard | P&L, pipeline, approvals, audit timeline, kill-switch |
| **Buzz web UI** | http://localhost:3002/repos | Relay SPA (Repositories view) |
| **Buzz relay API** | http://localhost:8081 | `/_liveness`, `/_readiness` |
| **Bridge API** | http://localhost:3100 | `/commands`, `/approvals`, `/metrics`, `/healthz`, `/readyz` |
| **Buzz Desktop** | installed app (or `buzz://` deep links) | Full channel workspace (chat) on `ws://localhost:3002` |

---

## Provisioning Buzz (automated, idempotent)

```bash
./scripts/provision-buzz-channels.sh
```

Creates (or verifies) the 12 business channels on the local relay, signed with the CEO key :
`ceo-command`, `ceo-digest`, `approbations-ceo`, `sales-acquisition`, `souscription-risque`,
`sinistres-contentieux`, `support-client`, `finance-pnl`, `marketing-veille`,
`conformite-rgpd`, `securite-incidents`, `simulation-events`.

Then posts a welcome message to `#approbations-ceo`.

### Manual CLI examples (Buzz desktop)

```bash
export BUZZ_RELAY_URL=http://localhost:3002
export BUZZ_PRIVATE_KEY=<CEO private key from .env>
"$HOME/AppData/Local/Buzz/buzz.exe" channels list
"$HOME/AppData/Local/Buzz/buzz.exe" messages get --channel <uuid>
"$HOME/AppData/Local/Buzz/buzz.exe" messages send --channel <uuid> --content "signed message"
```

---

## E2E acceptance (this run)

| # | Check | Result |
|---|---|---|
| 1 | `docker compose -f docker-compose.lite.yml up -d` | ✅ 15 services |
| 2 | CEO connects to Buzz workspace (relay) | ✅ CLI + desktop + web UI |
| 3 | Agents appear as distinct identities | ✅ Nostr keypairs per department |
| 4 | Synthetic lead → contract | ✅ seed (120/200) |
| 5 | Claim opened, provisioned, settled | ✅ 64 claims, 50 settled |
| 6 | Settlement > threshold creates CEO approval | ✅ workflow B proven (claim 64, €6,800) |
| 7 | Signed CEO decision resumes workflow | ✅ `execution=executed` |
| 8 | P&L report in Buzz + dashboard | ✅ 14 731 € net, ratio 11.7 % |
| 9 | Every action traceable (`correlation_id`) | ✅ audit chain intact |
| 10 | PII masked before LLM/Buzz | ✅ Presidio running |
| 11 | Kill-switch disables autonomy | ✅ tested |
| 12 | Git history via local Gitea | ✅ Gitea `:3010` |
| 13 | No paid API | ✅ 100 % local |
| 14 | Buzz channels provisioned + messages signed | ✅ 25 channels, welcome message |

---

## Demos ready to run

```bash
./scripts/healthcheck.sh                # health matrix
./scripts/demo/run-demo-e2e.sh          # reproducible E2E (13 checks)
./scripts/provision-buzz-channels.sh    # Buzz workspace provisioning
```

Investor narrative : [docs/15min-demo-guide.md](docs/15min-demo-guide.md)
Use cases : [docs/uses-cases/INDEX.md](docs/uses-cases/INDEX.md)
