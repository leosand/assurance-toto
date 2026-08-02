# Operations — Assurance Toto

## Prévol

```bash
git status --short
git diff --check
docker ps
```

## Tests

Aucun test automatisé défini actuellement.
Vérification manuelle via les scénarios dans `scenarios/`.

## Infrastructure Docker

```bash
# Démarrer l'infrastructure locale
docker compose -f docker-compose.lite.yml up -d

# Arrêter
docker compose -f docker-compose.lite.yml down

# Logs d'un agent
docker logs toto-agent-sales -f
```

## Git

```bash
git add <fichiers>          # staging explicite, jamais git add .
git commit -m "type(scope): description"
git push                    # uniquement après instruction humaine
```

## Conditions de déploiement

- Infrastructure Docker fonctionnelle (tous les conteneurs verts).
- Instruction humaine explicite reçue.
- Aucun `.zip` ne doit être commité (fichiers archivés exclus du staging).

## Rollback conceptuel

- Git revert : `git revert HEAD`
- Docker : `docker compose -f docker-compose.lite.yml down && docker compose -f docker-compose.lite.yml up -d`

## Propriétaires/accès

- Dépôt GitHub : `github.com/leosand/assurance-toto.git`
- Services externes : Rocket.Chat, MongoDB, Redis — configurés dans docker-compose.
- Variables d'environnement dans `.env` (non versionné).

## Sécurité

- Ne jamais mettre de secret, token, mot de passe ou URL de base dans ce document.
- Les fichiers `.zip` archivés ne doivent pas être commités (ajouter au `.gitignore` si nécessaire).
