# AGENTS.md — Assurance Toto

> Projet : Système multi-agents pour l'assurance (démo/preuve de concept).
> Documentation agent pour Kimi Code.

## Stack

- Agents Docker distincts (orchestrateur, sales, souscription, sinistres-contentieux ; +finance, support-client, marketing, conformite-it dans le profil full)
- Git MCP, Redis, PostgreSQL (x2), MinIO, Buzz (relais ghcr.io/block/buzz), bridge Buzz↔Hermes, Presidio (via docker-compose.lite.yml)
- Docker Compose pour l'infrastructure locale
- Le canal de collaboration est Buzz (Nostr) — Rocket.Chat/MongoDB archivés dans docker-compose.legacy-rocketchat.yml (cf. decisions/ceo-log.md, ADR-001)

## Commandes de validation

```bash
# Démarrer l'infrastructure locale
docker compose -f docker-compose.lite.yml up -d

# Vérifier les conteneurs
docker ps

# Logs d'un agent spécifique
docker logs <nom-conteneur>
```

## Règles de sécurité

- Ne jamais lire ou modifier `.env`, secrets, credentials.
- Les fichiers `.zip` dans la racine ne sont pas des sources — ne pas les modifier.
- Ne jamais effectuer de `git add .` ou `git add -A`.

## Règles Git

- Staging explicite uniquement.
- Commit : `git commit -m "type(scope): description"`
- Ne jamais `git push` sans instruction humaine explicite.
- Remote : `github.com/leosand/assurance-toto.git`

## Procédure avant livraison

1. `git status --short` — vérifier que seuls les fichiers attendus sont modifiés
2. `git diff --check`
3. Vérifier les conteneurs Docker actifs

## Docker

- Chaque agent a son propre Dockerfile dans `agents/<nom>/`
- L'infrastructure de démo est définie dans `docker-compose.lite.yml` (profil MVP)
  et `docker-compose.yml` (profil complet, 8 agents, nats en option)

## Décisions

- Les décisions techniques sont documentées dans `decisions/`
- Les scénarios de test sont dans `scenarios/`
