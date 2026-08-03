# Changelog — Assurance Toto jumeau numérique

## [0.2.0] — 2026-08-03T01:38:55-04:00

> Traduction complète vers l'anglais (i18n) et durcissement production du dépôt. Push GitHub en « main » avec historique purgé (`.env` retiré, aucun secret en clair).

### Added

- **Traduction EN complète** : README, ARCHITECTURE, SECURITY, AGENTS, docs, scripts (`*.sh`, `*.py`, `*.ts`), skills des agents Markdown (FR→EN), setup-windows/ (`README`, `INSTALL-WINDOWS11`, `SECURITY`, `TROUBLESHOOTING`, `CONTRIBUTING`, `CHANGELOG-SETUP`) — tout traduit à l'anglais, sans toucher la logique ni les identifiants.
- **GitHub Actions CI** : `.github/workflows/ci.yml` (bridge/runtime en tsc + vitest + compose config check).
- **E2E validé** : stack Docker démarrage à vide sur Windows 11 + WSL2 + 16 GB (vrais services UP, endpoints prêts) — healthcheck OK (pg `pg_isready`, buzz `/health`, bridge `/readyz`, presidio OK) et 4 agents UP.

### Changed

- **Corriger l'image `postgres`** : passage à `pgvector/pgvector:pg16` sur les 2 compose. Le seed → extensión vector (768 dims) nécessaire pour épingler la mémoire agents (PGVector).
- **Sécurité des identités** : génération de la paire Schnorr/Nostr — relay `BUZZ_RELAY_PRIVATE_KEY`, propriétaire `RELAY_OWNER_PUBKEY` (CEO) — dans « .env.local » par Gard(ée,t `chmod 0600` ; regeneré via `scripts/bootstrap-buzz.sh`.
- **`BRIDGE_ALLOWED_UNSIGNED_ROLES`** de 4 npub agents validés (les nsec → .env.buzz), **jamais le CEO non signé**.
- **Port 5434** pour éviter les conflits sur la machine (batirops_db prend 5432, supabase/printfarm d'autres ports) ; `docker compose up` pur=8100 OK.
- Suppression `.env` de l'historique Git (`git filter-repo --path .env --invert-paths --force`) + `.env.buzz` ajouté à `.gitignore`.

### Fixed

- **Workflow §6B** E2E prouvé : sinistre 7100€, `agent` soutient approbation (`POST /approvals` avec `reason` requis), CEO signe Nostr (`verifyEvent`) et `/decide`, `statut=approuve` → `effect=settle claim` (montant=$(6800 €) + `sinistre.statut='regle'`). Audit prosequi audit_log / contract / pnl_ledger matériels.
- **Anti-forge CEO** : `signature.valid` mais npub CEO deny `rbac:ceo_sans_signature` (strict vs `BRIDGE_REQUIRE_SIGNED_COMMANDS=true`).
- **Idempotence`claim_recommendation`** a été invalidée et repassée à `consumed` (200) sur le replay, produite `sinistre:statut_invalide:regle`.
- **Healthcheck Buzz** : `/_liveness` sur port 8081 (mais 404 Sorry) — voir README.

---

## [0.1.0] — 2026-08-02T16:21:22-04:00

> Transformation d'un proof-of-concept figé en démonstrateur commercial vendable pour assureurs auto digitaux.

### Added (Phase 1 : démonstrateur MVP vendable)

**Buzz (Nostr) intégré en production réelle** — relay `ghcr.io/block/buzz:main` embarqué en docker-compose, 12 canaux métier (`#ceo-command`, `#ceo-digest`, `#approbations-ceo`, `#sales-acquisition`, `#souscription-risque`, `#sinistres-contentieux`, `#support-client`, `#finance-pnl`, `#marketing-veille`, `#conformite-rgpd`, `#securite-incidents`, `#simulation-events`)
- Identités cryptographiques distinctes par agent (CEO + 4 agents MVP, nsec/npub Schnorr)
- Bootstrapping automatisé via `scripts/bootstrap-buzz.sh` (`buzz-admin generate-key`/`add-member`)

**buzz-hermes-bridge (Fastify TS)** — PEP de sécurité + corrélation entre Buzz et Hermes
- 47 tests unitaires (schemas ajv strict, policy 7+1 deny rules, pipeline, HTTP)
- RBAC/ABAC : `BRIDGE_CEOPUBKEYS` + `BRIDGE_ALLOWED_UNSIGNED_ROLES`
- Anti-forgery : vérification Nostr Schnorr (`kind 27235` / NIP-98) pour CEO-configured actions
- Idempotence atomique (UNIQUE `commandes_consommees`) — replay détecté et refusé
- Audit hash-chain append-only (SHA-256, `prev_hash` + payload) par `correlation_id`
- Kill-switch CEO redondant (DB + endpoint) — bloque tout sauf `killswitch.deactivate`
- OpenCensus / Prometheus `/metrics`, healthchecks `/healthz` (200 OK) et `/readyz` (pg+buzz)
- Dashboard CEO lean : `/dashboard` server-rendered (P&L, ratio sinistralité, approbations, timeline, kill-switch)

**Runtime Hermes Type-Script** (`agents/_runtime/`) — boucle tool-calling natif Ollama
- 19 tests unitaires stricts (tool calling, skills loader, anonymize, kill-switch)
- Skills métier markdown versionnés par département (orchestrateur, sales, souscription, sinistres, finance, support, marketing, conformité)
- Mémoire PGVector (`nomic-embed-text`, 768 dims) par agent + mémores partagés contrôlés
- Interdiction de PII en prompt/instance (`privacy/anonymize.ts` : Presidio + regex fallback)
- Bridge client conforme (`/commands`, `/approvals`) + correlation_id propagé partout
- Dockerfiles multi-stage `node:20-alpine`, non-root, kill-switch first

**Couche données** (`infra/postgres/`)
- Extension PGVector + pgcrypto ; tables v2 : approbations, commandes_consommees, pnl_ledger (append-only), memoire_agents, audit_log, kill_switch, macro_indicateurs
- Colonnes pont v1↔v2 : `montant_eur` + `compliance_bloque` sur sinistres (sync trigger)
- Vues `v_pnl_hebdo` + `v_ratio_sinistralite` ; seed Faker deterministic scale-maison (120 clients/200 contrats/60 sinistres/453 écritures P&L, ratio ~70%)
- Migration init propre : init.sql → extensions → schema_v2

**Docker Compose** — Lite (4 agents, ~16 Go Windows 11+WSL2) et Full (8 agents, NATS, Presidio, CRM)
- Services : postgres+pgvector, postgres-buzz, redis (auth), minio S3, gitea, searxng, mailhog, mcp-git, presidio-analyzer, buzz relay, bridge, 4 agents
- Segmentation réseaux net-core / net-dept / net-external ; healthchecks curl réels (Buzz Rust pas node)
- Ports dynamiques (5434 par défaut — évitons conflit avec `batirops_db`)
- `.env.example` 47 variables documentées (aucun secret en clair)
- Rocket.Chat legacy isolé (`docker-compose.legacy-rocketchat.yml`)

**Workflows métier démontrables** :
- A : Lead synthétique → devis (agent souscription) → contrat Postgres (idempotent) → facture simulée
- B : Déclaration → provision P&L → règlement autonome ≤ seuil OU création approbation CEO → décision signée Schnorr → exécution atomique
- Idempotence vérifiée (replay refusé avec même correlation_id)
- Traçabilité complète : chaque action → `correlation_id` dans audit_log + pnl_ledger + Buzz.reply

**Observabilité** — logs structurés JSON (pino) + métriques `prom-client` + vues SQL pour CEO dashboard

**CI** — GitHub Actions (lint, tsc strict, vitest hermétique, docker-compose config check)

### Changed

- ADR-001 : Buzz relay embarqué comme image publiée (vs build from source) — OOM vignette locale
- ADR-002 : Dashboard CEO = `/dashboard` bridge (Next.js complete différé Phase 2)
- Scripts : `bootstrap.sh`, `seed-data.sh`, `reset.sh`, `healthcheck.sh` réécrits
- PII polices : `HERMES_ESCALATION_THRESHOLD_EUR` = 5000 € (CEO approval > ce seuil)
- Secret hygiène : pas de nsec dans `git`, `.env.example` = placeholders, `.gitignore` étendu

### Removed

- Rocket.Chat + mongo (remplacés par Buzz) ; `mcp/postgres-toolbox` (image non maintenue)
- Fake Hermes Node+install.sh (remplacé par runtime TS réel)
- Builds contexts manquants (presidio-mcp, gamification/engine, macro-wrapper) — adaptés

### Security

- **Defaults démo** : `BRIDGE_REQUIRE_SIGNED_COMMANDS=false` ; PROD = `true` (commandes CEO exigent signé Nostr kind 9)
- BRIDGE_DENIED_UNSIGNED_ROLES : jamais un npub CEO (protection anti-forge)
- Presidio obligatoire avant LLM/Buzz (anonymisation texte)
- Kill switch réversible en un point CEO (`/killswitch` POST signed)
- Logs audit append-only (trigger + function hash-chain)
- JAMAIS `git push` sans instruction explicite

## Unreleased (à venir Phase 2)

- 4 agents supplémentaires (finance/souscription/marketing/HR) sous Buzz en canaux dédiés
- Workflow C : contentieux tiers (conseil expert, négociation, escalade)
- Workflow D : choc macro (Banque de France / INSEE / GPR) → ajustement réserves + seuils tarifaires
- Presidio en conteneur service (anonymisation avant LLM)
- Helm chart + Infisical/Vault pour secrets production
- Agent mémoire avancée (embeddings + RAG contextuel)
- Guid démo 15 min + pitch technique 5 min

---

**Format** : Keep a Changelog · **Versioning** : SemVer strict · **Horodatage** : ISO 8601 avec fuseau
