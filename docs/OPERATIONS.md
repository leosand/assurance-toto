# Operations — Assurance Toto

## Pre-flight

```bash
git status --short
git diff --check
docker ps
```

## Tests

No automated tests currently defined.
Manual verification via the scenarios in `scenarios/`.

## Docker infrastructure

```bash
# Start the local infrastructure
docker compose -f docker-compose.lite.yml up -d

# Stop
docker compose -f docker-compose.lite.yml down

# Logs of an agent
docker logs toto-agent-sales -f
```

## Git

```bash
git add <files>   # explicit staging, never git add .
git commit -m "type(scope): description"
git push only after explicit human instruction
```

## Deployment conditions

- Docker infrastructure healthy (all containers green).
- Explicit human instruction received.
- No `.zip` may be committed (archived files excluded from staging).

## Conceptual rollback

- Git revert: `git revert HEAD`
- Docker: `docker compose -f docker-compose.lite.yml down && docker compose -f docker-compose.lite.yml up -d`

## Owners/access

- GitHub repository: `github.com/leosand/assurance-toto.git`
- External services: Rocket.Chat, MongoDB, Redis — configured in docker-compose.
- Environment variables in `.env` (not versioned).

## Security

- Never put any secret, token, password, or base URL in this document.
- Archived `.zip` files must not be committed (add to `.gitignore` if needed).
