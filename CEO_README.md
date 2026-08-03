# CEO Guide — Quick Supervision

This document provides executives with the essential commands and access points to supervise the state of the "Assurance Toto" digital twin.

1) Services overview

 - Launch the status view:
```bash
docker compose -f docker-compose.lite.yml ps
```

2) Useful web interfaces

 - Gitea (repositories) : http://localhost:3000
 - Rocket.Chat (internal communication) : http://localhost:3001
 - MailHog (sent emails) : http://localhost:8025

3) Real-time monitoring

 - Follow an agent's logs:
```bash
docker compose -f docker-compose.lite.yml logs -f agent-sales
```

 - Docker usage statistics (CPU / RAM per container):
```bash
docker stats --no-stream
```

4) Frequent operational commands

 - Restart a problematic agent:
```bash
docker compose -f docker-compose.lite.yml restart agent-sales
```

 - Full rebuild (after code or config updates):
```bash
docker compose -f docker-compose.lite.yml build --no-cache
docker compose -f docker-compose.lite.yml up -d
```

5) Audit and historical logs

 - Export a container's logs:
```bash
docker logs --since="24h" toto-agent-sales > /tmp/agent-sales-logs-24h.log
```

6) Security and compliance notes

 - The `hermes.config.json` files define the MCP endpoints and the `tools_allowlist`. Do not share these files outside the organization.
 - For compliance and audit purposes, I recommend adding a log-archiving pipeline to encrypted storage (S3/Blob) and enabling Grafana dashboards if needed.

Recently modified files (summary):

 - `docker-compose.lite.yml` — removed `version` and switched to per-agent local Dockerfiles
 - `agents/*/Dockerfile` — added local Dockerfile to fix `COPY` errors
 - `scripts/fix-docker-creds.sh` — utility to resolve Docker credential helper errors
 - `CHANGELOG.md` and `setup-hermes-windows/CHANGELOG-SETUP.md` — updated release notes
