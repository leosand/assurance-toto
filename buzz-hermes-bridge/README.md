# buzz-hermes-bridge

Checkpoint de sécurité / corrélation entre le workspace **Buzz** (collaboration, identité Nostr, approbations) et le runtime **Hermes** pour le projet **Assurance Toto**.

Positionnement : chaque action autonome d'un agent Hermes qui touche l'argent, les contrats ou le kill-switch passe par ce bridge, qui applique (dans l'ordre) schéma strict → identité Nostr → kill-switch → politique métier → idempotence → audit hash-chainé → effet transactionnel Postgres, puis répond sur le canal Buzz avec le même `correlation_id`.

Ne fait **aucun appel à une API payante** ; toutes les données sont synthétiques.

## Pile

Node 20+ / TypeScript strict / Fastify / Postgres (`pg`) / Redis (`ioredis`, optionnel) / `nostr-tools` 2.24+ / ajv + zod.

## Installation et validation locale (sans Docker)

```bash
npm install
npm run build    # tsc (stdio)
npm test         # vitest : 39 tests sur schéma, politique (7 règles de deny), idempotence, audit, killswitch, corrél ation
```

## Démarrage

```bash
# Buzz + Postgres requis en prod ; en démo, tout reste fonctionnel sans eux :
# - sans BUZZ_PRIVATE_KEY      → NullCollabAdapter (capture locale, rien de posté)
# - sans Redis                 → DLQ en mémoire
# - sans Postgres reachable    → readyz=503 (pg down)
npm start
```

## Configuration (env)

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3100` | HTTP Fastify |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/assurance_toto` | connexion pg |
| `REDIS_URL` | `redis://localhost:6379` | DLQ Redis stream `dlq:commands` |
| `BUZZ_RELAY_URL` | `http://localhost:3000` | relais Buzz (REST `/events`, `/query`) |
| `BUZZ_PRIVATE_KEY` | — (absent ⇒ NullCollabAdapter) | nsec1… ou hex64 du bridge |
| `BRIDGE_CEOPUBKEYS` | vide (aucun CEO ⇒ tout deny) | npub/hex CEO whitelistés, séparés par `,` |
| `CLAIM_SETTLEMENT_THRESHOLD_EUR` | `5000` | plafond règlement (seuil autonomie agent §6B) |
| `BRIDGE_REQUIRE_SIGNED_COMMANDS` | `false` (démo locale) — **PROD : `true`** | exige un event Nostr signé pour les actions réservées au CEO (reject / pricing exception / kill-switch) ; `401 auth:ceo_sans_signature_valide` sinon |
| `BRIDGE_ALLOWED_UNSIGNED_ROLES` | vide (aucun agent non signé) | npub/hex d'agents Hermes acceptés SANS signature (Phase 1). **Ne jamais y mettre un npub CEO** — un CEO non signé est refusé (`rbac:ceo_sans_signature`), allowlist ou non |
| `APPROVAL_TTL_MINUTES` | `10080` | TTL approbations |

Jamais de secret en clair : `.env.buzz` est généré par `npm run init-buzz-keys` en mode 0600, gitignored — voir `docs/keychain.md`.

## Endpoints HTTP (Fastify)

- `GET  /healthz` — liveness
- `GET  /readyz` — pg + adapter (+ redis si branché), `503` si l'un tombe
- `GET  /metrics` — texte Prometheus (`prom-client`)
- `GET  /approvals` — file `statut='en_attente'`
- `POST /commands` — soumission directe (démo/tests + callbacks Hermes)
- `POST /approvals/:correlationId/decide` — décision CEO (signature Nostr exigée si `event` fourni)
- `POST /killswitch` — activate/deactivate (CEO uniquement)
- `GET  /dlq` — entrées de dead-letter
- `GET  /audit/verify` — vérifie la chaîne d'audit (peut être long)

## Commandes typées (schémas ajv stricts, `additionalProperties:false`)

- `claim.settlement.approve` `{type, claim_id, max_amount_eur, reason, approved_by, requested_at}`
- `claim.settlement.reject`
- `policy.pricing.exception.approve`
- `agent.killswitch.activate` / `agent.killswitch.deactivate`
- `finance.report.request`

**Toute commande en texte libre est rejetée d'emblée** (couvert par le test `rejette une chaîne de texte libre`).

## Les 7 règles de deny (politique pure, `src/policy/policy.ts`)

1. Auteur sans rôle CEO / délégation → deny
2. Sinistre introuvable ou mauvais statut → deny
3. `montant > plafond autorisé` (`CLAIM_SETTLEMENT_THRESHOLD_EUR`) → deny
4. Signature Nostr invalide → deny (vérifiée en amont : `NIP-98` sur REST, `NIP-01`+`verifyEvent` côté pipeline)
5. Approbation identique déjà consommée (`commandes_consommees`) → deny
6. Flag conformité sur le dossier → deny
7. Schéma invalide → deny

## Autonomie agent (§6B) + anti-forgery

**Autonomie bornée sur `claim.settlement.approve`** (`src/policy/policy.ts → evaluateClaimApprove`) :

- `montant_eur ≤ CLAIM_SETTLEMENT_THRESHOLD_EUR` : un **agent sinistres** (rôle résolu depuis `BRIDGE_ALLOWED_UNSIGNED_ROLES`, event non signé accepté en Phase 1) PEUT s'auto-régler ; le CEO signé aussi.
- `montant_eur > seuil` : **CEO signé uniquement**. Un agent sinistres est refusé (`rbac:au_dessus_seuil_reserve_CEO`) et doit créer une approbation `en_attente` via `POST /approvals` (visible sur `GET /approvals` / dashboard CEO).
- Toute autre rôle (`agent-sales`, `agent-souscription`, `finance`, `conformite`, `inconnu`) est refusé : `rbac:reglement_non_autorise_pour_role`.
- Les autres règles de deny (introuvable / statut / plafond / conformité / idempotence / schéma / kill-switch) s'appliquent inchangées, quel que soit le montant.

**Anti-forgery** (durcissement §6A) :

1. Un `author_pubkey` npub CEO **sans event Nostr signé** est refusé net côté pipeline : `rbac:ceo_sans_signature` — l'identité CEO ne peut pas être forgée par simple déclaration d'un npub whitelisté.
2. `BRIDGE_REQUIRE_SIGNED_COMMANDS=true` (obligatoire en production) : les actions à effet réservées au CEO exigent de plus une signature vérifiée (kind 9) — sinon `401 auth:ceo_sans_signature_valide`.
3. `POST /approvals` (escalade agent → CEO, §6B) : l'auteur doit être un npub connu (CEO ou `BRIDGE_ALLOWED_UNSIGNED_ROLES`), sinon `403 auteur_non_allowliste`. Créer une **demande** n'exige pas de signature — la décision, elle, reste CEO-signée.

`GET /approvals` expose les demandes `en_attente` ; `POST /approvals` les crée (cf. repository `createApprobation`, table `approbations` du `schema_v2.sql`).

## Idempotence

`commandes_consommees.command_id` (PK) avec `INSERT … ON CONFLICT DO NOTHING`. Le hash `command_id` est calculé sur le **contenu** JSON de la commande (pas l'id de transport), pour rester stable entre canal Buzz et callback HTTP.

## Audit hash-chainé

`audit_log.hash = sha256(prev_hash + canonicalJson(payload))`, `canonicalJson` = clés triées récursivement. `src/audit.ts → verifyAuditChain()` est appelé par `GET /audit/verify` et le script `npm run verify-audit`. Un test pousse une falsification dans l'audit et vérifie que la chaîne casse.

## Kill-switch

Une seule ligne `kill_switch (id=1)`. Quand `actif=true`, toute exécution autonome est bloquée **sauf** `agent.killswitch.deactivate`. Couvert par test (pendant le lock, deactivate passe, le reste tombe en `denied`).

## Corrélation

`correlation_id` UUID par ingress (généré si absent). On le retrouve systématiquement dans :

- `audit_log.correlation_id`
- `commandes_consommees.correlation_id`
- `pnl_ledger.correlation_id`
- texte du message Buzz retour + `correlation_id` explicit dans le JSON de contenu

Le test `correlation_id propagate` vérifie que l'UUID fourni à l'ingress se retrouve **inchangé** dans l'audit, le ledger et le message Buzz (via la capture du `NullCollabAdapter`).

## Application (effet métier, `settleClaimEffect`)

Pour `claim.settlement.approve`, en **une** transaction Postgres :

- `INSERT pnl_ledger (categorie='reglement', montant=-min(max_amount_eur, seuil))`
- `UPDATE sinistres SET statut='regle'`
- `UPDATE approbations SET statut='approuve' WHERE correlation_id=…`

## DLQ

Erreur non réessayable (signature invalide, deny politique, règle métier) → pas de retry, audit `command.dlq` + entrée Redis stream `dlq:commands`. Erreur réessayable (connexion pg/redis) → retry par l'upstream (réponse `5xx` côté HTTP, `postMessage` = throw côté Buzz).

## Anti-lock-in

La pipeline ne connaît que l'interface `CollabAdapter` (`src/collab/CollabAdapter.ts`) : `BuzzAdapter` (Nostr + HTTP REST au relais Buzz) est **une** implémentation. `NullCollabAdapter` (capture mémoire) sert de fallback documenté et permet de faire tourner toute la boucle sans Buzz, Postgres reachable ni Redis. Basculer sur une autre brique de collaboration = réimplémenter 4 méthodes, aucun changement de politique.

## Multi-agents

Les 9 keypairs (CEO + 8 agents) sont générées par `npm run init-buzz-keys`. Chaque keypair Nostr sert d'identité d'agent (npub = handle d'autorité, nsec = secret à protéger, voir `docs/keychain.md`).

## Ce qui a été assumé explicitement sur l'API Buzz (diverge possible du brief)

- Endpoint REST exposé sur le même host que WS (`BUZZ_RELAY_URL`) : `POST /events`, `POST /query`, `POST /count`, `GET /health`, `/_liveness`, `/_readiness`.
- Auth REST par header `Authorization: Nostr <base64(json du kind:27235 signé)>`, tags `[u, method, payload, t]` — aligné `nostr-tools/nip98`.
- Réponse `POST /events` : `{"event_id","accepted","message"}` ; l'erreur HTTP est propagée telle quelle (`4xx/5xx`).
- Channel `ensureChannel` est un no-op : Buzz crée le channel à la volée sur le premier `kind:9` avec le tag `h`.
- La souscription WS (NIP-01 + NIP-42) n'est pas branchée au démarrage (polling REST suffit au checkpoint) — `BuzzAdapter.subscribeChannel` reste un point d'extension commenté.

## Ce que Docker aurait permis de valider (mais le démon est down)

- `docker build -t assurance-toto/buzz-hermes-bridge .`
- `docker compose -f ../docker-compose.lite.yml up postgres redis` puis test d'intégration sur pg réel
- roundtrip réel `BuzzAdapter` → relais Buzz local (ghcr.io/block/buzz:main) + WS NIP-42 validation
- `scripts/verify-audit.ts` contre une vraie base avec données du seed
- test de la télémétrie Prometheus sur `/metrics` via `fetch` réseau
