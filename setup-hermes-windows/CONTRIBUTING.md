# Contributing to the Assurance Toto project

This project is an educational demonstrator. All contributions go through the **local Gitea** repository, not GitHub.

## Workflow

1. Create a local branch: `git checkout -b feature/nom-fonctionnalite`
2. Modify the skills (`agents/*/skills/*.md`) or the gamification engine code.
3. Test locally via `docker compose up` before committing.
4. Commit with a clear message: `git commit -m "feat(sales): ajoute skill de scoring lead"`
5. Push to local Gitea: `git push origin feature/nom-fonctionnalite`
6. Open a Pull Request in the Gitea interface (http://localhost:3000).

## Commit naming conventions

- `feat(department):` new feature
- `fix(department):` bug fix
- `skill(department):` add/modify a Hermes skill
- `security:` security/compliance-related change
- `docs:` documentation

## Adding a new department / agent

1. Create `agents/<nom-departement>/hermes.config.json` (copy an existing agent).
2. Create `agents/<nom-departement>/skills/*.md`.
3. Add the MCP allowlist entry in `security/mcp-allowlist.json`.
4. Add the service in `docker-compose.yml`.
5. Document the agent in the README.
