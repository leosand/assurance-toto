# Changelog

## Unreleased

- Fix: Remove obsolete `version` key from `docker-compose.lite.yml` and Windows variant to avoid Compose warning.
- Fix: Add per-agent `Dockerfile` files in `agents/*` so Docker builds use the agent folder as build context and `COPY` finds `hermes.config.json` and `skills/` reliably.
- Doc: Note about build/auth errors when pulling base images — check Docker credentials/daemon if image pull fails.
 - Tool: Add `scripts/fix-docker-creds.sh` to help backup and remove problematic Docker `credsStore`/`credHelpers` entries in `~/.docker/config.json`.
 - Validate: Build and run of the four lite agents (`orchestrateur`, `sales`, `souscription`, `sinistres-contentieux`) succeeded locally on 2026-07-24 after applying the fixes and resolving Docker credential issues.
 - UX: Add `CEO_README.md` with a short supervision guide (commands, URLs, monitoring tips).
 - Docs: Add 'Supervision' section to `setup-hermes-windows/README.md` describing quick checks and web UIs for executives.
 - Fix: Add `db` (MongoDB) service to `docker-compose.lite.yml` to satisfy Rocket.Chat's MongoDB dependency and restore http://localhost:3001 access.
