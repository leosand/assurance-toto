# Assurance Toto — Digital twin of a car insurance company operated by AI agents

**Commercial demo** : a 50-employee digital car insurance company ideally operated by a CEO assisted by a fleet of **AI agents** — with mandatory human control, full traceability, security by default, and **compliance-oriented by design**. French insurance domain.

## Stack

| Component | Technology | Role |
|---|---|---|
| **Brain** | Hermes Agent runtime (TypeScript, `agents/_runtime/`) | Executes workflows, loads business skill, persistent memory, MCP calls |
| Cockpit | **Buzz by Block** (`ghcr.io/block/buzz:main`) + lean dashboard | CEO cockpit, cryptographic Nostr identities, signed audit log |
| Orchestration/filtering | **buzz-hermes-bridge** (Node 20 + Fastify, `buzz-hermes-bridge/`) | Policy validation, idempotency, correlation_id, chained audit |
| Data | PostgreSQL + PGVector (`pgvector/pgvector:pg16`) | Source of truth (`approbations`, `pnl_ledger`, `audit_log`, memory) |
| Anonymization | Presidio (`mcr.microsoft.com/presidio-analyzer`) | PII masked before LLM/Buzz |
| Local LLM | **Ollama on the host** (`gemma4:e4b` default, `gemma4:e4b-16k` long, `hermes3:8b` fallback) | Native tool calling via `POST /api/chat` |
| Embeddings | Ollama `nomic-embed-text` (768 dims) | Agent memory PGVector |
| Metrics | Prometheus (`prom-client`) + SQL views | `/metrics` + auto P&L |
| Integrations | SearXNG, MailHog, Gitea, MinIO S3 | Web search, email simulation, Git, storage |

## Architecture

```
CEO/Ops ──► Buzz (:3002 web + relay :8080 API) ──► buzz-hermes-bridge (:3100)
   │ channels #ceo-* │  ├─ Policy enforcement (policy.ts)
   ├─ identities │  ├─ Idempotency (commandes_consommees UNIQUE)
   │ npub/nsec │  ├─ Append-only audit
   └─────────────┘  └─ Correlation_ID + Postgres effects

                            ▼
        ┌──────────────────────────────────────┐
        │ Hermes Orchestrator + 4 MVP agents    │
        │ (Orchestrator, Sales, Underwriting,   │
        │  Claims-Litigation)                   │
        └──────────────────────────────────────┘
                            │
                    MCP Gateway (allowlist)
                            │
        ┌───────────────┬───────────────┬───────┐
        │  PG+PGVector  │  Redis(+auth) │ Presidio
        │ (real views)  │ (internal bus) │ anonym.
        └───────────────┴───────────────┴───────┘
                            │
                Public macro APIs (Banque de France, INSEE)
```

**Buzz is not a source of truth** : business data stays in Postgres ; Buzz documents cooperation (identities, signatures, approvals). The bridge (which is the **control point**) verifies authentication + policy + idempotence, then applies the transactional business effect.

## Prerequisites

- Windows 11 + WSL2 + Docker Desktop ≥ 24 + 16 GB RAM (+1 GB free)
- Ollama native on Windows (default) — direct Linux supported with adjustments
- `host.docker.internal` resolved (native Docker Desktop 4.30+)
- Free local ports: **5432** (postgres), **3002** (Buzz web/relay), **3100** (bridge /health), **8081** (Buzz health API), 3000 (ollama), 6379 (Redis), 9000/9001 (MinIO)
- **No paid API**: OpenAI/Anthropic/OpenRouter removed

## Quick start — Windows 11 + WSL2 (lite mode)

```bash
# 1) environment variables
cp .env.example .env
# generate your secrets (via Git Bash/WSL2):
node -e "const c=require('crypto');console.log({
  PG_PASSWORD: c.randomBytes(24).toString('hex'),
  REDIS_PASSWORD: c.randomBytes(24).toString('hex'),
  MINIO_ROOT_PASSWORD: c.randomBytes(24).toString('hex'),
  BUZZ_PG_PASSWORD: c.randomBytes(24).toString('hex'),
  BUZZ_S3_SECRET_KEY: c.randomBytes(24).toString('hex'),
})" # + Buzz keys (next step)
nano .env

# 2) Ollama prerequisites (local LLM, Windows host)
ollama list  # verify gemma4:e4b installed, otherwise: ollama pull gemma4:e4b
ollama pull nomic-embed-text
# ⚠️ Ollama must run on Windows (host) — not in Docker

# 3) start (Lite, 4 agents)
docker compose -f docker-compose.lite.yml up -d

# 4) bootstrap Buzz (identities, channels)
./scripts/bootstrap-buzz.sh   # generates agent npubs + creates the 12 channels

# 5) seed demo data + health
./scripts/seed.sh --scale-maison
./scripts/healthcheck.sh

# 6) reproducible E2E demo (13 min, proves §6B)
./scripts/demo/run-demo-e2e.sh
```

### Local endpoints

- **CEO dashboard (lean cockpit)**: http://localhost:3100/dashboard
- **Buzz workspace** (relay + web UI): http://localhost:3002 (`RELAY_OWNER_PUBKEY` = CEO, generated at bootstrap)
- **Bridge API**: http://localhost:3100 (`/commands`, `/approvals`, `/healthz`, `/readyz`, `/metrics`)
- **Buzz Admin API**: http://localhost:8081 (`/health`, `/_liveness`, `/_readiness`)
- **Postgres**: localhost:5432 (credentials in `.env`)
- **Gitea**: http://localhost:3000 (local git, skills compiler)
- **SearXNG**: http://localhost:3005 ; **MailHog**: http://localhost:8025
- **MinIO (S3)**: http://localhost:9000

## Acceptance criteria (brief §11)

- [x] `docker compose -f docker-compose.lite.yml up -d` `:` functional demo (lite)
- [x] Local CEO connects to the Buzz workspace (`RELAY_OWNER_PUBKEY`)
- [x] 4 Hermes agents = distinct identities (derived npub/nsec, allowlists)
- [x] Synthetic lead → contract (sales agent → underwriting → Postgres contract)
- [x] Claim opened, provisioned, settled autonomously ≤ 5000 € (no escalation)
- [x] Claim settlement > threshold creates a CEO approval in Buzz → signed decision → settlement execution (verified E2E)
- [x] Valid and signed CEO decision triggers the correct workflow in Hermes
- [x] P&L report generated and displayed in Buzz and dashboard
- [x] Every action traceable via `correlation_id` (audit_log + logs + Buzz)
- [x] Synthetic PII masked before LLM/Buzz (Presidio)
- [x] CEO kill switch immediately disables autonomous execution
- [x] Git history traced via local Gitea
- [x] No cost required for the demo

## Honest limitations (sandbox, not production)

- 7B/8B models: limited supported reasoning — skills are designed with guardrails + structured JSON to improve reliability. We *know* the limits.
- No ACPR/RGPD certification — it is **compliance-oriented by design** (demo, sandbox), not ready for real data without hardening (Phase 3).
- `README`: 100 % synthetic Faker data (fr_FR), reproducible (`--scale-maison`).
- No raw PII: every bridge route anonymizes before writing to LLM/Buzz.

## Development

### Tests

| Package | Local (Node 22+) | Suite | Details |
|---|---|---|---|
| `buzz-hermes-bridge` | `npm test` | 47 vitest tests | 7+1 deny policy rules, idempotency, forgery detection |
| `agents/_runtime` | `npm test` | 19 vitest tests | tool calling, skills, kill-switch, structured runTask |

### Conventions

- Strict TS (`noImplicitAny`, `strictNullChecks`), no `any`
- ESLint + Prettier if present, otherwise conventional "small deep modules" style
- FR comments for business logic, EN comments for generic code/schemas
- Git Bash / JS for the bridge builder / tests, ops scripts

### CI/CD (reference)

- **Local Gitea** as the initial Git source of truth (Buzz Git behind feature flag); front-end pushes to Buzz use seamless web UI branch transitions.
- Buzz secrets/keys are generated by `scripts/bootstrap-buzz.sh`, stored in `.env.buzz` (gitignored, 0600).
- **Vercel**: this project stays self-hosted (local demo) — no public deployment.

## Repository structure

```
assurance-toto/
├── docker-compose.lite.yml      # 4-agent WSL2 MVP (this page)
├── docker-compose.yml           # 8 agents full (scale)
├── docker-compose.legacy-rocketchat.yml  # Rocket.Chat migration point (legacy)
├── .env.example                 # 47 documented environment variables
├── buzz-hermes-bridge/          # Policy validation + correlation + audit
│   ├── src/{pipeline,policy,audit,server}.ts
│   ├── src/http/server.ts        # Fastify routes /commands /approvals /dashboard /kill-switch /health
│   ├── src/collab/{CollabAdapter,BuzzAdapter}.ts # Nostr client ↔ Buzz relay
│   └── tests/*.test.ts           # 47 strict-mode tests
├── agents/
│   ├── _runtime/               # Shared Hermes runtime assembly (tsc + skill loader + ollama)
│   │   └── src/{runtime,tools,security,llm,privacy}.ts
│   ├── orchestrateur/          # + hermes.config.json + skills/*.md + mcp-allowlist.json + interface.md
│   ├── sales/ souscription/ sinistres-contentieux/ # 4 MVP agents
│   └── {finance,support-client,marketing,conformite-it}/ # Phase 2 (8 agents total)
├── infra/postgres/
│   ├── init.sql                # v1 schema (composite initExtension)
│   ├── init_extensions.sql     # vectors + pgcrypto
│   ├── schema_v2.sql           # v2 tables (approbations, audit, PII-safe, industry macros)
│   ├── seed_faker.py           # Reliable Faker CLI seed (--scale-maison for special demos)
│   └── README.md               # DB maintenance manual
├── docs/NETWORKING.md           # Docker network separation net-core/dept/external
├── scenarios/                  # README files for 6 alien cases (text files)
├── scripts/                    # Access + bash ops scripts (seed, healthcheck, demo)
└── decisions/ceo-log.md        # ADR-001 buzz-image, ADR-002 dashboard-lean, ADR-001 Buzz alignment
```

## Contact / License

- Development: Kimi Code + client teaser sponsor
- Local LLM: no cloud access required (Ollama LLM)
- Buzz by Block is Apache 2.0 upstream; this project remains group-company licensed as an "internal-use demonstrator"
- Marketing: use this text for the video-call pitch and close

---

## ⚡ Ready for the demo (copy-paste commands)

```bash
cd "assurance-toto"
cp .env.example .env          # + generate secrets (see Quick start)
docker compose -f docker-compose.lite.yml up -d
./scripts/bootstrap-buzz.sh    # Buzz identities + channels
./scripts/seed.sh --scale-maison
curl -s http://localhost:3100/readyz    # must: {"pg":"ok","buzz":"ok","status":"ready"}
./scripts/healthcheck.sh     # 4/4 OK
./scripts/demo/run-demo-e2e.sh
```
