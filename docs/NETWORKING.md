# NETWORKING — Assurance Toto

Matrix service → network → exposed ports, and trust boundaries for
`docker-compose.lite.yml` (MVP profile) and `docker-compose.yml` (full profile).

## Networks (internal Docker bridges)

| Network | Role | Trust boundary |
|---|---|---|
| `net-core` | Data and files: PostgreSQL, Redis, MinIO, NATS bus | **Strict internal** — no port published to the host; only trusted services are attached |
| `net-dept` | Agents: Hermes runtime, bridge, MCP tools (mcp-git), Buzz | **Broad internal** — agents and internal UIs talk to the `net-core` backends via never-exposed internal clients |
| `net-external` | Tools that talk to the outside: SearXNG (web), MailHog (demo SMTP) | **Outbound only** — external services have no access to `net-core` data except via explicit attachment |

> Ollama is **outside the container**: native on the Windows host, joined via
> `host.docker.internal` (extra_hosts `host-gateway`) + `${OLLAMA_HOST}`.

## Service matrix

| Service | Networks | Container port | Host port (published) | Comment |
|---|---|---|---|---|
| `postgres` (business) | net-core | 5432 | — | accessible only to joinable services (agent runtime, bridge) |
| `postgres-buzz` | net-core | 5432 | — | dedicated database for the Buzz relay, separate from business |
| `redis` | net-core, net-dept | 6379 | — | `--requirepass` (password via`REDIS_PASSWORD`); shared relay + bridge DLQ |
| `gitea` | net-dept | 3000 | 3000 | local repository UI |
| `mcp-git` | net-dept | 8090 | — | internal tool (SDK/agent), join internal Gitea |
| `searxng` | net-external | 8080 | — | outbound web search for agents |
| `mailhog` | net-external, net-dept | 8025 / 1025 | 8025 | demo web UI + internal SMTP |
| `buzz` (relay ghcr.io/block/buzz) | net-core, net-dept | 3000 (REST+WS+UI) / 8080 (health) | 3002 / 8080 | relay web UI + `/health`, `/_liveness`, `/_readiness` endpoints |
| `minio` | net-core | 9000 (S3) / 9001 (console) | 9000 / 9001 | Buzz media storage (path-style), host console |
| `minio-init` | net-core | — | — | one-shot `mc mb buzz-media`, ends before the relay starts |
| `buzz-hermes-bridge` | net-core, net-dept | 3100 | 3100 | `/healthz`, `/readyz`, `/commands`, `/approvals/decide`, `/killswitch`, audit |
| `presidio-analyzer` | net-core, net-dept | 3000 | 3003 | PII anonymization; host port renamed (3000 already taken by Gitea) |
| `nats` *(profile `nats`, full only)* | net-core | 4222 / 8222 | — | optional event bus |
| Hermes agents (orchestrateur, sales, souscription, sinistres-contentieux [+finance, support-client, marketing, conformite-it in the full profile]) | net-dept (+ net-external for sales / sinistres / marketing) | 4000 (internal healthz) | — | no published port: calls via `BRIDGE_URL` and `PRESIDIO_URL` |

## Key flows (trust boundaries)

- `agents` → `bridge` (net-dept): business commands; `bridge` → `buzz:3000`
  (NIP-98 REST `/events`, `/query`, kind 9, tag `ha`); CEO → `bridge`
  (`/approvals/:correlationId/decide`, `/killswitch`) with whitelist
  `BRIDGE_CEOPUBKEYS` (+ Nostr signature if `BRIDGE_REQUIRE_SIGNED_COMMANDS=true`).
- `bridge` / `runtime agents` → `postgres` (net-core) in read-only
  (internal runtime client).
- `buzz` → `postgres-buzz`, `redis`, `minio` (net-core only).
- Agents `sales`/`sinistres-contentieux`/`marketing` → `mailhog`,
  `searxng` (net-external) — only ± outbound ± flows, never to data.

## Port conflicts avoided

`3000` (host) is reserved for Gitea: the Buzz relay is published on **3002** and
Presidio on **3003**. No sensitive internal service (postgres, redis,
minio, bridge except 3100) exposes a data base port to
the host.
