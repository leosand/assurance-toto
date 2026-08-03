# Changelog — Windows 11 Setup Guide

## [1.0.2] — 2026-07-24

-### Added
- **`hermes.config.json`** : Created the Hermes configuration file for the 4 agents (orchestrateur, sales, souscription, sinistres-contentieux) — required by the `COPY` in the Dockerfiles.
- **`security/mcp-allowlist.json`** : Created the MCP allowlist — mounted as a volume by each agent.
- **`infra/postgres/init.sql`** : Replaced the empty folder with a real SQL file containing the initial schema (tables clients, contrats, sinistres, agent_actions).

### Fixed
- **`docker-compose.lite.yml`** : Updated to use local `Dockerfile`s (`agents/*/Dockerfile`) so that `COPY hermes.config.json` and `COPY skills/` work correctly in the build context.
- **Tools** : Added `scripts/fix-docker-creds.sh` to help fix Docker credential helper issues that were preventing image pull/build.
 - **Fix** : Added a `db` service (MongoDB) required by Rocket.Chat and updated the Rocke.Chat service dependency in `docker-compose.lite.yml`.

## [1.0.1] — 2026-07-24

### Changed & Fixed
- **Ollama Models** : Aligned on `qwen2.5-coder:7b` (primary) and `gemma4:e4b` (fallback). # was: gemma4-12b
- **`docker-compose.lite.yml`** : Removed the unresolved external dependency `mcp-postgres` from the agents so they can start cleanly without a remote image pull error.
- **`INSTALL-WINDOWS11.md`** : Fixed the initialization sequence in step 7 (removed the blocking seed script and deleted the `mcp-postgres` parameter).

## [1.0.0] — 2026-07-23

### Added
- Complete Windows 11 installation guide (WSL2 + Docker Desktop + Ollama + VS Code).
- Pre-configured `.env.lite.example` file for Gemma 4 12B / Qwen2.5-Coder 7B.
- `docker-compose.lite.yml` limited to 4 agents (Orchestrateur, Sales, Souscription, Sinistres-Contentieux).
- PowerShell diagnostic scripts (`check-ram-vram.ps1`, `ollama-context-test.ps1`).
- `TROUBLESHOOTING.md` file covering the most common Windows/WSL2/Ollama/Hermes errors.
- Recommended VS Code configuration (`.vscode/settings.json`, `.vscode/extensions.json`).

### Context
- Written following confirmation of the user's hardware: Windows 11, Gemma 4 12B or Qwen2.5-Coder 7B, VS Code/OpenCode.
- Goal: enable a progressive rollout of the Assurance Toto digital twin on consumer hardware, without a powerful dedicated GPU.
