# CEO Guide — Supervision rapide

Ce document fournit aux dirigeants les commandes et points d'accès essentiels pour superviser l'état du jumeau numérique "Assurance Toto".

1) Vue d'ensemble des services

 - Lancer la vue d'état :
```bash
docker compose -f docker-compose.lite.yml ps
```

2) Interfaces web utiles

 - Gitea (dépôts) : http://localhost:3000
 - Rocket.Chat (communication interne) : http://localhost:3001
 - MailHog (emails envoyés) : http://localhost:8025

3) Surveillance en temps réel

 - Suivre les logs d'un agent :
```bash
docker compose -f docker-compose.lite.yml logs -f agent-sales
```

 - Statistiques d'utilisation Docker (CPU / RAM par conteneur) :
```bash
docker stats --no-stream
```

4) Commandes opérationnelles fréquentes

 - Redémarrer un agent problématique :
```bash
docker compose -f docker-compose.lite.yml restart agent-sales
```

 - Rebuild complet (si mise à jour du code ou configs) :
```bash
docker compose -f docker-compose.lite.yml build --no-cache
docker compose -f docker-compose.lite.yml up -d
```

5) Audit et logs historiques

 - Exporter les logs d'un conteneur :
```bash
docker logs --since="24h" toto-agent-sales > /tmp/agent-sales-logs-24h.log
```

6) Remarques de sécurité et conformité

 - Les fichiers `hermes.config.json` définissent les endpoints MCP et la `tools_allowlist`. Ne partagez pas ces fichiers hors de l'organisation.
 - Pour conformité et audit, je recommande d'ajouter une pipeline d'archivage des logs vers un stockage chiffré (S3/Blob) et d'activer des tableaux de bord Grafana si besoin.

Fichiers modifiés récemment (résumé) :

 - `docker-compose.lite.yml` — suppression de `version` et usage de Dockerfiles locaux par agent
 - `agents/*/Dockerfile` — Dockerfile local ajouté pour corriger les erreurs de `COPY`
 - `scripts/fix-docker-creds.sh` — utilitaire pour résoudre les erreurs de credential helper Docker
 - `CHANGELOG.md` et `setup-hermes-windows/CHANGELOG-SETUP.md` — mise à jour des notes de version
