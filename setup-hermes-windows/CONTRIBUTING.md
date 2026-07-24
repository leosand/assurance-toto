# Contribuer au projet Assurance Toto

Ce projet est un démonstrateur pédagogique. Toute contribution passe par le dépôt **Gitea local**, pas GitHub.

## Workflow

1. Créer une branche locale : `git checkout -b feature/nom-fonctionnalite`
2. Modifier les skills (`agents/*/skills/*.md`) ou le code du moteur de gamification.
3. Tester en local via `docker compose up` avant de committer.
4. Committer avec un message clair : `git commit -m "feat(sales): ajoute skill de scoring lead"`
5. Pousser vers Gitea local : `git push origin feature/nom-fonctionnalite`
6. Ouvrir une Pull Request dans l'interface Gitea (http://localhost:3000).

## Conventions de nommage des commits

- `feat(department):` nouvelle fonctionnalité
- `fix(department):` correction de bug
- `skill(department):` ajout/modification d'une compétence Hermes
- `security:` modification liée à la sécurité/conformité
- `docs:` documentation

## Ajouter un nouveau département / agent

1. Créer `agents/<nom-departement>/hermes.config.json` (copier un agent existant).
2. Créer `agents/<nom-departement>/skills/*.md`.
3. Ajouter l'entrée MCP allowlist dans `security/mcp-allowlist.json`.
4. Ajouter le service dans `docker-compose.yml`.
5. Documenter l'agent dans le README.
