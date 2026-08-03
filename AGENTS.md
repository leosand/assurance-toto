# AGENTS.md — Assurance Toto

> Project: Multi-agent system for insurance (demo/proof of concept).
> Agent documentation for Kimi Code.

## Stack

- Distinct Docker agents (orchestrateur, sales, souscription, sinistres-contentieux; +finance, support-client, marketing, conformite-it in the full profile)
- MCP Git, Redis, PostgreSQL (x2), MinIO, Buzz (relay ghcr.io/block/buzz), Buzz→Hermes bridge, Presidio (via docker-compose.lite.yml)
- Docker Compose for the local infrastructure
- The collaboration channel is Buzz (Nostr) — Rocket.Chat/MongoDB archived in docker-compose.legacy-rocketchat.yml (see decisions/ceo-log.md, ADR-001)

## Validation commands

```bash
# Start the local infrastructure
docker compose -f docker-compose.lite.yml up -d

# Check the containers
docker ps

# Logs of a specific agent
docker logs <container-name>
```

## Security rules

- Never read or modify `.env`, secrets, credentials.
- The `.zip` files in the root are not sources — do not modify them.
- Never run `git add .` or `git add -A`.

## Git rules

- Explicit staging only.
- Commit: `git commit -m "type(scope): description"`
- Never `git push` without explicit human instruction.
- Remote: `github.com/leoand/assurance-toto.git`

## Procedure before delivery

1. `git status --short` — verify that only the expected files are modified
2. `git diff --check`
3. Check the active Docker containers

## Docker

- Each agent has its own Dockerfile in `agents/<name>/`
- The demo infrastructure is defined in `docker-compose.lite.yml` (MVP profile)
  and `docker-compose.yml` (full profile, 8 agents, nats as an option)

## Decisions

- Technical decisions are documented in `decisions/`
- Test scenarios are in `scenarios/`
