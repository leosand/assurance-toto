# 🏦 Assurance Toto — AI-Operated Digital Car Insurance Twin

> A commercial-grade **digital twin** of a French car insurance company operated by a CEO assisted by a **fleet of autonomous AI agents** — with mandatory human control, full cryptographic traceability, and **compliance-oriented by design**.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Nostr](https://img.shields.io/badge/Protocol-Nostr-purple)](#)
[![Buzz by Block](https://img.shields.io/badge/Cockpit-Buzz%20by%20Block-black)](#)
[![Ollama](https://img.shields.io/badge/LLM-Ollama%20Local-success)](#)
[![PostgreSQL](https://img.shields.io/badge/DB-PostgreSQL%2016-336791?logo=postgresql)](#)
[![Docker](https://img.shields.io/badge/Deploy-Docker%20Compose-2496ED?logo=docker)](#)
[![Tests: 75](https://img.shields.io/badge/tests-75%20green-brightgreen)](#)
[![No paid APIs](https://img.shields.io/badge/API-0%20paid%20dependency-success)](#)

---

## 🎯 What is this?

Assurance Toto simulates a **50-employee digital car insurer** run as a multi-agent organization:

- A **CEO (human)** supervises via a Nostr-based workspace (**Buzz**) and a lean CEO cockpit.
- **8 business agents** (sales, underwriting, claims & litigation, finance, support, marketing, compliance, orchestration) execute workflows on a **local LLM** (Ollama, `gemma4:e4b`).
- Every action is a **cryptographically signed event**; every high-stakes decision (claim settlement above a threshold, pricing exceptions, kill-switch) **requires explicit CEO approval**.
- Full traceability via a **hash-chained append-only audit log** and an end-to-end `correlation_id`.

It is a **sellable demo** for French/EU auto insurers, brokers, insurtechs and transformation consultancies — designed to prove : reduced cost per claim, faster underwriting, shorter response time, human control on high-risk decisions, sovereign self-hosted deployment, and **zero paid API dependency**.

> ⚠️ **Honest positioning** : this is a sandbox-ready, compliance-oriented **demonstrator**. It is **not** ACPR/RGPD-certified and does not process real personal data (100 % synthetic Faker data).

---

## ✨ Key Features

### 🤖 AI-Operated Insurance Organization

- **Hermes agent runtime** (TypeScript) : each department is an agent instance with versioned business skills, persistent PGVector memory, and MCP tool allowlists
- **Native tool-calling** on Ollama `gemma4:eb` (local, free, no cloud)
- **8 agents** : orchestrateur, sales, souscription (underwriting), sinistres-contentieux (claims/litigation), finance, support-client, marketing, conformité-it

### 🛡️ Human Control & Governance

- **CEO approval required** for every settlement above the threshold (default €5,000), pricing exceptions, and kill-switch
- **Kill-switch** : CEO can freeze all autonomous execution instantly
- **Anti-forgery** : decisions require a verified Nostr Schnorr signature
- **Idempotency** : an approval can never be consumed twice

### 🔐 Security & Traceability

- **Buzz by Block** (`ghcr.io/block/buzz:main`) : Nostr workspace where humans and agents are first-class equals, every event signed
- **Hash-chained append-only audit log** (`prev_hash` → `sha256(prev_hash + payload)`)
- **PII anonymization** via Microsoft Presidio before any LLM call
- **PostgreSQL as source of truth** : Buzz never stores business truth — the bridge enforces policy and writes transactional effects

### 📊 Real-Time Executive Cockpit

- **CEO dashboard** (served by the bridge) : net result, weekly P&L, claims-to-premiums ratio, sales pipeline, pending approvals, audit timeline, kill-switch state
- Prometheus `/metrics`, structured JSON logs (pino), health endpoints

### 🚀 Sovereign, Offline, Free

- **100 % open source**, self-hosted, no external API, works on **Windows 11 + WSL2 + Docker Desktop (16 GB RAM)**
- Local LLM (Ollama) — models `gemma4:e4b` / `gemma4:e4b-16k` / `hermes3:8b`
- Full demo footprint ≈ **2.6 GB of Docker images**

---

## 🏗️ Architecture

```
CEO / Ops (human)
   │  Buzz workspace :3002  (Nostr relay, signed identities, channels)
   ▼
buzz-hermes-bridge :3100  ── policy enforcement ── idempotency ── audit chain
   │                         JSON Schema strict, RBAC/ABAC, correlation_id
   ▼
Hermes Orchestrator  (TypeScript runtime, Ollama gemma4:e4b)
   ├─ Sales / Acquisition
   ├─ Underwriting (Souscription)
   ├─ Claims & Litigation (Sinistres-Contentieux)
   ├─ Finance / Support / Marketing / Compliance
   ▼
MCP allowlist ── Postgres+PGVector · Redis · Presidio (PII) · Gitea · SearXNG · MailHog · MinIO
```

**Postgres is the source of truth. Buzz is the collaboration & audit layer. The bridge is the control point.**

Full diagrams, event flows, trust boundaries and permission matrix : see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 🛠️ Technical Stack

| Layer | Technology |
|---|---|
| **Agent runtime** | TypeScript, Node 20, strict `noImplicitAny` |
| **Orchestration / policy** | Node 20 + Fastify (`buzz-hermes-bridge`) |
| **Collaboration / identity** | Buzz by Block — Nostr relay `ghcr.io/block/buzz:main` |
| **LLM** | Ollama local (`gemma4:e4b`, `gemma4:e4b-16k`, `hermes3:8b`, `nomic-embed-text`) |
| **Database** | PostgreSQL 16 + PGVector (`pgvector/pgvector:pg16`) |
| **PII protection** | Microsoft Presidio (`mcr.microsoft.com/presidio-analyzer`) |
| **Message bus** | Redis (auth, streams) |
| **Web search / email / Git / storage** | SearXNG, MailHog, Gitea, MinIO S3 |
| **Testing** | Vitest, tsc strict — 75 tests (56 bridge + 19 runtime) |
| **Deployment** | Docker Compose (lite 21 services / full 26 services) |

---

## 🚀 Getting Started

### Prerequisites

- **Windows 11 + WSL2 + Docker Desktop ≥ 24** (16 GB RAM recommended)
- **Ollama** running **natively on the host** (models `gemma4:e4b` and `nomic-embed-text`)

### Standard Installation

> 📄 Full guide : [QUICKSTART.md](QUICKSTART.md)

```bash
# 1) Clone
git clone https://github.com/leosand/assurance-toto.git
cd assurance-toto

# 2) Environment (documented template, zero real secrets)
cp .env.example .env
# ... then generate real passwords + Nostr keypairs (see QUICKSTART.md §2)

# 3) Start the stack (Lite: 4 agents, 16 GB target)
docker compose -f docker-compose.lite.yml up -d

# 4) Bootstrap Buzz identities + channels
./scripts/bootstrap-buzz.sh

# 5) Seed demo data (120 clients, 200 contracts, ~60 claims, P&L)
./scripts/seed.sh --scale-maison

# 6) Verify health
./scripts/healthcheck.sh
```

The demo is now live :

| Interface | URL |
|---|---|
| **CEO cockpit** (dashboard) | http://localhost:3100/dashboard |
| **Buzz workspace** (web UI) | http://localhost:3002/repos |
| **Buzz relay API** | http://localhost:8081 |
| **Bridge API** | http://localhost:3100 (`/commands`, `/approvals`, `/metrics`, `/healthz`, `/readyz`) |
| **Postgres** | `localhost:5434` (credentials in `.env`) |

### Docker Installation (Full mode — 8 agents)

```bash
docker compose -f docker-compose.yml up -d
```

### Stop / Reset

```bash
docker compose -f docker-compose.lite.yml down          # stop, keep data
docker compose -f docker-compose.lite.yml down -v       # full reset (volumes)
./scripts/seed.sh --scale-maison                        # re-seed
```

---

## 🎬 15-Minute Demo

Run the reproducible end-to-end script:

```bash
./scripts/demo/run-demo-e2e.sh
```

Or follow the narrative walk-through : [docs/15min-demo-guide.md](docs/15min-demo-guide.md)

The demo proves : synthetic claim → auto-settle (≤ €5,000) **or** CEO approval (> €5,000, signed Nostr event) → settlement execution → P&L + audit trace + kill-switch freeze.

---

## 🧪 Testing & CI

| Package | Command | Suite |
|---|---|---|
| `buzz-hermes-bridge` | `npm test` | **56** vitest tests (policy, idempotency, anti-forgery, HTTP, dashboard) |
| `agents/_runtime` | `npm test` | **19** vitest tests (tool calling, skills, kill-switch, anonymize) |

CI (GitHub Actions) : strict `tsc`, vitest, Docker Compose config check, secrets scan (gitleaks).

---

## 📁 Project Structure

```
assurance-toto/
├── docker-compose.lite.yml          # 4-agent MVP (Windows 11 + WSL2, 16 GB)
├── docker-compose.yml               # 8-agent full profile
├── .env.example                     # 47 documented environment variables
├── buzz-hermes-bridge/              # Policy enforcement + correlation + audit
│   ├── src/{pipeline,policy,audit,server}.ts
│   ├── src/http/server.ts           # Fastify: /commands /approvals /dashboard /kill-switch /health
│   ├── src/collab/{CollabAdapter,BuzzAdapter}.ts   # Nostr client ↔ Buzz relay
│   └── tests/*.test.ts              # 56 strict tests
├── agents/
│   ├── _runtime/                    # Shared Hermes runtime (tool calling, skills, memory)
│   ├── orchestrateur/               # + hermes.config.json + skills/*.md + allowlist
│   ├── sales/ souscription/ sinistres-contentieux/ # MVP agents
│   └── finance/ support-client/ marketing/ conformite-it/  # Phase 2 agents
├── infra/postgres/                  # Schema v2 + PGVector + append-only triggers + seed
├── docs/                            # NETWORKING, 15min demo guide
├── scripts/                         # bootstrap, seed, healthcheck, reset, demo
├── decisions/ceo-log.md             # ADR-001 Buzz integration, ADR-002 dashboard lean
├── QUICKSTART.md                    # Full local launch guide
├── ARCHITECTURE.md                  # Mermaid diagrams, trust boundaries
├── SECURITY.md                      # Threat model, anti-prompt-injection, secrets
└── CHANGELOG.md                     # Keep a Changelog
```

---

## 🔧 Configuration

| File | Purpose |
|---|---|
| `.env.example` | Documented template — copy to `.env`, fill real secrets |
| `docker-compose.lite.yml` | Lite profile (4 agents, 16 GB target) |
| `docker-compose.yml` | Full profile (8 agents) |
| `agents/<dept>/hermes.config.json` | Per-agent runtime config (role, thresholds, MCP) |
| `agents/<dept>/mcp-allowlist.json` | Per-agent least-privilege tool allowlist |
| `buzz-hermes-bridge/src/policy/policy.ts` | Decision rules: roles, thresholds, compliance blocks |

---

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create your feature branch : `git checkout -b feature/AmazingFeature`
3. Commit your changes : `git commit -m 'feat: add some AmazingFeature'`
4. Push to the branch : `git push origin feature/AmazingFeature`
5. Open a Pull Request

See [CONTRIBUTING.md](setup-hermes-windows/CONTRIBUTING.md) for detailed guidelines.

---

## 📝 License

This project is licensed under the **Apache 2.0** License — see the [LICENSE](LICENSE) file for details.
Upstream : **Buzz by Block** (Apache 2.0), **Hermes** runtime concept, Nostr protocol (NIP-01/29/42/98).

---

## 👥 Team

- **Leon** — Lead Developer — [leosand](https://github.com/leosand)

---

## 🙏 Acknowledgments

- **Block, Inc.** — Buzz, the Nostr-based self-hosted workspace (Apache 2.0)
- **NousResearch** — Hermes agent ecosystem (upstream inspiration)
- **Microsoft Presidio** — PII anonymization
- **pgvector** — PostgreSQL vector search
- **Ollama** — local LLM runtime
- All contributors who help improve this project

---

## 📞 Support

For support, please:
- Open an issue on [GitHub](https://github.com/leosand/assurance-toto/issues)
- Contact the development team

---

## ⚡ Ready for the demo (copy-paste)

```bash
cd assurance-toto
cp .env.example .env                       # + generate secrets (QUICKSTART.md §2)
docker compose -f docker-compose.lite.yml up -d
./scripts/bootstrap-buzz.sh
./scripts/seed.sh --scale-maison
curl -s http://localhost:3100/readyz       # {"pg":"ok","buzz":"ok","status":"ready"}
./scripts/healthcheck.sh
./scripts/demo/run-demo-e2e.sh
```
