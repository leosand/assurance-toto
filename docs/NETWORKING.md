# NETWORKING — Assurance Toto

Matrice service → réseau → ports exposés, et frontières de confiance pour
`docker-compose.lite.yml` (profil MVP) et `docker-compose.yml` (profil full).

## Réseaux (bridges internes Docker)

| Réseau | Rôle | Frontière de confiance |
|---|---|---|
| `net-core` | Données et files : bases PostgreSQL, Redis, MinIO, bus NATS | **Interne strict** — aucun port publié vers l'hôte ; seuls les services de confiance y sont rattachés |
| `net-dept` | Agents : runtime Hermes, bridge, outils MCP (mcp-git), Buzz | **Interne élargi** — les agents et les UIs internes parlent aux backends de `net-core` via des clients internes jamais exposés |
| `net-external` | Outils qui dialoguent vers l'extérieur : SearXNG (web), MailHog (SMTP de démo) | **Sortante seule** — les services externes n'ont pas d'accès aux données de `net-core` sauf jointure explicite |
> Ollama est **hors conteneur** : natif sur l'hôte Windows, joint via
> `host.docker.internal` (extra_hosts `host-gateway`) + `${OLLAMA_HOST}`.

## Matrice des services

| Service | Réseaux | Port conteneur | Port hôte (publié) | Commentaire |
|---|---|---|---|---|
| `postgres` (métier) | net-core | 5432 | — | accessible uniquement aux services joinables (runtime agents, bridge) |
| `postgres-buzz` | net-core | 5432 | — | base dédiée du relais Buzz, séparée du métier |
| `redis` | net-core, net-dept | 6379 | — | `--requirepass` (mot de passe via `REDIS_PASSWORD`) ; partagé relais + DLQ bridge |
| `gitea` | net-dept | 3000 | 3000 | UI dépôts locaux |
| `mcp-git` | net-dept | 8090 | — | outil interne (SDK/agent), joint à Gitea interne |
| `searxng` | net-external | 8080 | — | recherche web sortante pour les agents |
| `mailhog` | net-external, net-dept | 8025 / 1025 | 8025 | UI web de démo + SMTP interne |
| `buzz` (relais ghcr.io/block/buzz) | net-core, net-dept | 3000 (REST+WS+UI) / 8080 (santé) | 3002 / 8080 | web UI du relais + endpoints `/health`, `/_liveness`, `/_readiness` |
| `minio` | net-core | 9000 (S3) / 9001 (console) | 9000 / 9001 | stockage médias Buzz (path-style), console hôte |
| `minio-init` | net-core | — | — | one-shot `mc mb buzz-media`, terminé avant le démarrage du relais |
| `buzz-hermes-bridge` | net-core, net-dept | 3100 | 3100 | `/healthz`, `/readyz`, `/commands`, `/approvals/decide`, `/killswitch`, audit |
| `presidio-analyzer` | net-core, net-dept | 3000 | 3003 | anonymisation PII ; port hôte renommé (3000 déjà pris par Gitea) |
| `nats` *(profil `nats`, full uniquement)* | net-core | 4222 / 8222 | — | bus d'événements optionnel |
| Agents Hermes (orchestrateur, sales, souscription, sinistres-contentieux [+finance, support-client, marketing, conformite-it dans le profil full]) | net-dept (+ net-external pour sales / sinistres / marketing) | 4000 (healthz interne) | — | aucun port publié : appels via `BRIDGE_URL` et `PRESIDIO_URL` |

## Flux clés (trust boundaries)

- `agents` → `bridge` (net-dept) : commandes métier ; `bridge` → `buzz:3000`
  (NIP-98 REST `/events`, `/query`, kind 9, tag `h`) ; CEO → `bridge`
  (`/approvals/:correlationId/decide`, `/killswitch`) avec whitelist
  `BRIDGE_CEOPUBKEYS` (+ signature Nostr si `BRIDGE_REQUIRE_SIGNED_COMMANDS=true`).
- `bridge` / `runtime agents` → `postgres` (net-core) en lecture seule
  (client interne du runtime).
- `buzz` → `postgres-buzz`, `redis`, `minio` (net-core uniquement).
- Agents `sales`/`sinistres-contentieux`/`marketing` → `mailhog`,
  `searxng` (net-external) — seuls flux « sortants », jamais vers les données.

## Conflits de ports évités

`3000` (hôte) est réservé à Gitea : le relais Buzz est publié sur **3002** et
Presidio sur **3003**. Aucun service interne sensible (postgres, redis,
minio, bridge à l'exception de 3100) n'expose de port base de données vers
l'hôte.
