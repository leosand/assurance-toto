# Assurance Toto — Local Launch Guide

> How to start, verify and use the full digital-twin demo on your machine.
> Target environment : Windows 11 + WSL2 + Docker Desktop (16 GB RAM) + Ollama on the host.

---

## 1. Prerequisites (one-time)

```bash
# Docker Desktop running (version 24+)
docker info --format '{{.ServerVersion}}'

# Ollama running natively on the host (NOT inside Docker)
ollama list          # must include gemma4:e4b and nomic-embed-text
```

If a model is missing:
```bash
ollama pull gemma4:e4b
ollama pull nomic-embed-text
```

---

## 2. Configure environment (one-time)

```bash
cd "assurance-toto"

# Create .env from the documented template
cp .env.example .env

# Generate real secrets (passwords + Nostr Schnorr keypairs for CEO + 8 agents)
node -e '
const fs=require("fs"); const crypto=require("crypto");
const { generateSecretKey, getPublicKey } = require("./buzz-hermes-bridge/node_modules/nostr-tools/pure");
const hex=()=>crypto.randomBytes(32).toString("hex");
const pair=()=>{const sk=generateSecretKey(); return {sk:Buffer.from(sk).toString("hex"), pk:getPublicKey(sk)}};
const ceo=pair();
let s=fs.readFileSync(".env","utf8");
const put=(k,v)=>s=s.replace(new RegExp("^"+k+"=.*$","m"), k+"="+v);
for(const k of ["PG_PASSWORD","REDIS_PASSWORD","MINIO_ROOT_PASSWORD","BUZZ_PG_PASSWORD","BUZZ_S3_SECRET_KEY","GITEA_ADMIN_PASSWORD","GITEA_ACCESS_TOKEN"]) put(k,hex().slice(0,48));
put("BUZZ_RELAY_PRIVATE_KEY",ceo.sk); put("RELAY_OWNER_PUBKEY",ceo.pk); put("BUZZ_PRIVATE_KEY",ceo.sk); put("BRIDGE_CEOPUBKEYS",ceo.pk);
const agents={ORCHESTRATEUR:pair(),SALES:pair(),SOUSCRIPTION:pair(),SINISTRES:pair(),FINANCE:pair(),SUPPORT:pair(),MARKETING:pair(),CONFORMITE:pair()};
put("BRIDGE_ALLOWED_UNSIGNED_ROLES",Object.values(agents).map(a=>a.pk).join(","));
for(const [n,a] of Object.entries(agents)){ put("AGENT_NSEC_"+n,a.sk); put("AGENT_NPUB_"+n,a.pk); }
fs.writeFileSync(".env",s);
console.log(".env ready — CEO pubkey:", ceo.pk.slice(0,16)+"…");
'
```

> ⚠️ `.env` is gitignored — it never leaves your machine.

---

## 3. Start the stack

### Lite mode (4 agents — recommended for 16 GB RAM)

```bash
docker compose -f docker-compose.lite.yml up -d
```

### Full mode (8 agents — needs a stronger machine)

```bash
docker compose -f docker-compose.yml up -d
```

First launch pulls images (`ghcr.io/block/buzz`, `pgvector/pgvector:pg16`, `mcr.microsoft.com/presidio-analyzer`) and builds the bridge + agents — allow a few minutes.

---

## 4. Verify everything is healthy

```bash
# Quick health matrix (postgres, buzz, bridge, presidio)
./scripts/healthcheck.sh

# Bridge readiness (checks pg + buzz connectivity)
curl -s http://localhost:3100/readyz
# expected: {"pg":"ok","buzz":"ok","status":"ready"}
```

---

## 5. Seed demo data (120 clients / 200 contracts / ~60 claims)

```bash
./scripts/seed.sh --scale-maison
```

---

## 6. Open the interfaces

| Interface | URL | Purpose |
|---|---|---|
| **CEO cockpit** (dashboard) | http://localhost:3100/dashboard | P&L, sales pipeline, pending CEO approvals, audit timeline, kill-switch |
| **Buzz workspace** | http://localhost:3002 | Nostr-based team/agent channels, signed events |
| **Buzz health** | http://localhost:8081 | relay liveness/readiness |
| **Bridge API** | http://localhost:3100 | `/commands`, `/approvals`, `/metrics` |
| **Postgres** | `localhost:5434` | schema v2 (credentials in `.env`) |
| **Gitea** | http://localhost:3010 | local Git (skills, changelog) |
| **MailHog** | http://localhost:8025 | simulated email |
| **MinIO** | http://localhost:9000 | S3 media (Buzz) |

> Ports are configurable via `.env` (`PG_PORT`, `GITEA_PORT`, …) if occupied.

---

## 7. Run the 15-minute demo

```bash
./scripts/demo/run-demo-e2e.sh
```

This proves end-to-end : synthetic claim → auto-settle (≤ €5000) OR CEO approval (> €5000, signed Nostr) → settlement execution → P&L + audit trace.

Manual walk-through (narrative) : see [docs/15min-demo-guide.md](docs/15min-demo-guide.md).

---

## 8. Stop / reset

```bash
# Stop (keep data volumes)
docker compose -f docker-compose.lite.yml down

# Full reset (delete volumes + re-seed from scratch)
docker compose -f docker-compose.lite.yml down -v
./scripts/seed.sh --scale-maison
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` | Edit `.env`: `PG_PORT`, `GITEA_PORT`, or free the port |
| Buzz unhealthy (password auth failed) | `docker compose down -v` then `up -d` (regenerates volumes with current `.env`) |
| Ollama not reachable | Ensure Ollama runs on the HOST, check `OLLAMA_HOST=http://host.docker.internal:11434` |
| `mcp-git` crash loop | Rebuild: `docker compose -f docker-compose.lite.yml build mcp-git && up -d mcp-git` |
| Agents FAIL healthz | Check `OLLAMA_HOST` and that `gemma4:e4b` is pulled |

---

## Architecture at a glance

```
CEO / Ops
   │  Buzz workspace (:3002, Nostr, signed identities)
   ▼
buzz-hermes-bridge (:3100)  ── policy, idempotency, audit chain, correlation_id
   │
   ▼
Hermes Orchestrator + 8 agents  (TS runtime, Ollama gemma4:e4b)
   │
   ▼
MCP allowlist ── Postgres+PGVector · Redis · Presidio (PII) · Gitea · SearXNG · MailHog · MinIO
```

**Postgres is the source of truth. Buzz is the collaboration/audit layer. The bridge is the control point.**
