# Assurance Toto — Jumeau numérique d'une compagnie d'assurance auto pilotée par des agents IA

**Démonstrateur vendable** : une compagnie d'assurance auto digitale de 50 employés idéalement opérée par un CEO assisté d'une flotte d'agents IA autonomes — avec contrôle humain obligatoire, traçabilité complète, sécurité par défaut, et **compliance-oriented by design**.

## Stack

| Composant | Technologie | Rôle |
|---|---|---|
| **Cerveau** | Hermes Agent runtime (TypeScript, `agents/_runtime/`) | Exécute workflows, charge skill métier, mémoire persistante, appels MCP |
| Cockpit | **Buzz by Block** (`ghcr.io/block/buzz:main`) + dashboard lean | Cockpit CEO, identités Nostr cryptographiques, audit log signé |
| Orchestration/filtrage | **buzz-hermes-bridge** (Node 20 + Fastify, `buzz-hermes-bridge/`) | Validation politique, idempotence, correlation_id, audit chaîné |
| Données | PostgreSQL + PGVector (`pgvector/pgvector:pg16`) | Source de vérité (`approbations`, `pnl_ledger`, `audit_log`, mémoire) |
| Anonymisation | Presidio (`mcr.microsoft.com/presidio-analyzer`) | PII masquée avant LLM/Buzz |
| LLM local | **Ollama sur l'hôte** (`gemma4:e4b` par défaut, `gemma4:e4b-16k` long, `hermes3:8b` fallback) | Tool calling natif via `POST /api/chat` |
| Embeddings | Ollama `nomic-embed-text` (768 dims) | Mémoire agents PGVector |
| Métriques | Prometheus (`prom-client`) + vues SQL | `/metrics` + P&L auto |
| Intégrations | SearXNG, MailHog, Gitea, MinIO S3 | Recherche web, simulation email, Git, stockage |

## Architecture

```
CEO/Ops ──► Buzz (:3002 web + relay :8080 API) ──► buzz-hermes-bridge (:3100)
   │ canaux #ceo-* │  ├─ Policy enforcement (policy.ts)
   ├─ identités  │  ├─ Idempotence (commandes_consommees UNIQUE)
   │ npub/nsec  │  ├─ Audit append-only
   └─────────────┘  └─ Correlation_ID + effects Postgres

                            ▼
        ┌──────────────────────────────────────┐
        │  Hermes Orchestrateur + 4 agents MVP   │
        │  (Orchestrateur,Sales,Souscription,   │
        │   Sinistres-Contentieux)              │
        └──────────────────────────────────────┘
                            │
                    MCP Gateway (allowlist)
                            │
        ┌───────────────┬───────────────┬───────┐
        │  PG+PGVector  │  Redis(+auth) │ Presidio
        │  (vraies vues)│  (bus interne) │  anonym.
        └───────────────┴───────────────┴───────┘
                            │
                Apis macro publiques (Banque de France, INSEE)
```

**Buzz n'est pas une source de vérité** : les données métier restent en Postgres ; Buzz documente la coopération (identités, signatures, approvals). Le bridge (qui est le **point de contrôle**) vérifie authentification + politique + idempotence, puis applique l'effet métier transactionnel.

## Prérequis

- Windows 11 + WSL2 + Docker Desktop ≥ 24 + 16 Go RAM (+1 GB libre)
- Ollama natif sur Windows (par défaut) — ajustement si Linux direct possible
- `host.docker.internal` résolu (natif Docker Desktop 4.30+)
- Ports locaux libres : **5432** (postgres), **3002** (Buzz web/relay), **3100** (bridge /health), **8081** (Buzz API santé), 3000 (ollama), 6379 (Redis), 9000/9001 (MinIO)
- **Aucune API payante** : OpenAI/Anthropic/OpenRouter supprimés

## Démarrage rapide — Windows 11 + WSL2 (mode lite)

```bash
# 1) variables d'environnement
cp .env.example .env
# générer vos secrets (via Git Bash/WSL2) :
node -e "const c=require('crypto');console.log({
  PG_PASSWORD: c.randomBytes(24).toString('hex'),
  REDIS_PASSWORD: c.randomBytes(24).toString('hex'),
  MINIO_ROOT_PASSWORD: c.randomBytes(24).toString('hex'),
  BUZZ_PG_PASSWORD: c.randomBytes(24).toString('hex'),
  BUZZ_S3_SECRET_KEY: c.randomBytes(24).toString('hex'),
})" # + clés Buzz (étape suivante)
nano .env

# 2) prérequis Ollama (LLM local, hôte Windows)
ollama list  # vérifier gemma4:e4b installé, sinon: ollama pull gemma4:e4b
ollama pull nomic-embed-text
# ⚠️ Ollama doit tourner sur Windows (host) — pas dans Docker

# 3) démarrer (Lite, 4 agents)
docker compose -f docker-compose.lite.yml up -d

# 4) bootstrap Buzz (identités, canaux)
./scripts/bootstrap-buzz.sh   # génère npubs agents + crée les 12 canaux

# 5) seed démo + health
./scripts/seed.sh --scale-maison
./scripts/healthcheck.sh

# 6) démo E2E reproductible (13 min, prouve §6B)
./scripts/demo/run-demo-e2e.sh
```

### Points de terminaison (locaux)

- **Dashboard CEO (cockpit lean)** : http://localhost:3100/dashboard
- **Buzz workspace** (relay + web UI) : http://localhost:3002 (`RELAY_OWNER_PUBKEY` = CEO, générée au bootstrap)
- **Bridge API** : http://localhost:3100 (`/commands`, `/approvals`, `/healthz`, `/readyz`, `/metrics`)
- **Buzz Admin API** : http://localhost:8081 (`/health`, `/_liveness`, `/_readiness`)
- **Postgres** : localhost:5432 (sj credentials dans `.env`)
- **Gitea** : http://localhost:3000 (git local, skills compiler)
- **SearXNG** : http://localhost:3005 ; **MailHog** : http://localhost:8025
- **MinIO (S3)** : http://localhost:9000

## Critères d'acceptation (brief §11)

- [x] `docker compose -f docker-compose.lite.yml up -d` `:` démo fonctionnelle (lit')
- [x] CEO local se connecte au workspace Buzz (`RELAY_OWNER_PUBKEY`)
- [x] 4 agents Hermes = identités distinctes (npub/nsec dérivés, allowlists)
- [x] Lead synthétique → contrat (agent sales → souscription → contrat Postgres)
- [x] Sinistre ouvert, provisionné, réglé autonome ≤ 5000 € (sans escalade)
- [x] Règlement > seuil crée approbation CEO dans Buzz → décision signée → exécution du règlement (vérifié E2E)
- [x] Décision CEO valide + signée déclenche workflow correct dans Hermes
- [x] Rapport P&L généré et affiché dans Buzz et dashboard
- [x] Chaque action traçable via `correlation_id` (audit_log + logs + Buzz)
- [x] PII synthétique masquée avant LLM/Buzz (Presidio)
- [x] Kill switch CEO désactive immédiatement l'exécution autonome
- [x] Historique Git tracé via Gitea local
- [x] Aucun coût requis pour la démo

## Limitations honnêtes (sandbox, pas production)

- Modèles 7B/8B : raisonnement assisté restreint — les skills sont conçus « garde-fous + JSON structuré » pour fiabiliser. On *connaît* les limites.
- Pas de certification ACPR/RGPD — c'est **compliance-oriented by design** (demo, sandbox), pas prêt pour données réelles sans durcissement (Phase 3).
- `README` : données 100 % synthétiques Faker (fr_FR), reproductibles (`--scale-maison`).
- Aucune PII brute : chaque route le bridge anonymise avant d'écrire LLM/Buzz.

## Développement

### Tests

| Package | Local (Node 22+) | Boîtes | Détails |
|---|---|---|---|
| `buzz-hermes-bridge` | `npm test` | vitest 47 tests | policy 7+1 deny rules, idempotence, détection forge |
| `agents/_runtime` | `npm test` | vitest 19 tests | tool calling, skills, killwitch, runTask structuré |

### Conventions

- TS strict (`noImplicitAny`, `strictNullchecks`), aucun `any`
- ESLint + Prettier si présent, sinon style conventionnel "small deep modules"
- Commentaires FR pour logique métier, commentaires EN _pour code générique/schémas
- Binary (`11, Git Bash`/JS pour le `bridge`builder / tests, scripts d'ops

### CI / CD (référence)

- **Gitea local** comme source de vérité Git initiale (Buzz Git derrière feature flag); pushs frontend vers Buzz seamless transitions de branch web UI.
- Les secrets/clefs Buzz sont générés par `scripts/bootstrap-buzz.sh`, stockés dans `.env.buzz` (gitignored, 0600).
- **Vercel** : ce projet reste self-hosted (démo local) — aucun déploiement public.

## Structure du dépôt

```
assurance-toto/
├── docker-compose.lite.yml      # MVP 4-agents WSL2 (cette page)
├── docker-compose.yml           # 8 agents full (scale)
├── docker-compose.legacy-rocketchat.yml  # Point de migration Rocket.Chat (legacy)
├── .env.example                 # 47 vars documentées (CEO Kafka sur importance HOPKINS)
├── buzz-hermes-bridge/          # Validation politique + corrélation + audit
│   ├── src/{pipeline,policy,audit,server}.ts
│   ├── src/http/server.ts        # Fastify route /commands /approals /dashboard /kill-switch /health
│   ├── src/collab/{CollabAdapter,BuzzAdapter}.ts # Nostr client ↔ Buzz relay
│   └── tests/*.test.ts           # 47 tests strict-mode
├── agents/
│   ├── _runtime/               # Runtime Hermes montage commun (tsc + skill loader + ollama)
│   │   └── src/{runtime,tools,security,llm,privacy}.ts
│   ├── orchestrateur/          # + hermes.config.json + skills/*.md + mcp-allowlist.json + interface.md
│   ├── sales/ souscription/ sinistres-contentieux/ # 4 agents MVP
│   └── {finance,support-client,marketing,conformite-it}/ # Phase 2 (8 agents totaux)
├── infra/postgres/
│   ├── init.sql                # Schéma v1 (composite initExtension)
│   ├── init_extensions.sql     # vectors+pgcrypto
│   ├── schema_v2.sql           # Tables v2 (approbations, audit, PII-safe, macros industrie)
│   ├── seed_faker.py           # Seed fiable CLI Faker (--scale-maison pour démos spéciales)
│   └── README.md               # Manuel de maintenance DB
├── docs/NETWORKING.md           # Séparation réseaux Docker net-core/dept/external
├── scenarios/                  # Fichiers README 6 cas aliens (fichiers texte)
├── scripts/                    # Access + bash (CF header Lit, seed, healthcheck, demo)
└── decisions/ceo-log.md        # ADR-001 buzz-image #02-002 dashboard-lean # ADR-001 Buzz alignement
```

## Contact / License

- Développement : Kimi Code + Commanditaire depuis le client teaser
- LLM local : aucun accès cloud requis (lich LLM Ollama)
- Buzz by Block ? Apache 2.0 upstream; ce projet reste sous groupe société Licencié "démonstrateur internal use"
- Marketing SPN (reponsabilité) : use ce texte pour bricole rendez-vous visio; conclure ce pitch.

---

## ⚡ Prêt pour la démo (commandes copiables)

```bash
cd "assurance-toto"
cp .env.example .env          # + générer secrets (voir section Démarrage rapide)
docker compose -f docker-compose.lite.yml up -d
./scripts/bootstrap-buzz.sh    # Buzz identities + canaux
./scripts/seed.sh --scale-maison
curl -s http://localhost:3100/readyz    # must: {"pg":"ok","buzz":"ok","status":"ready"}
./scripts/healthcheck.sh      # 4/4 OK
./scripts/demo/run-demo-e2e.sh
```
