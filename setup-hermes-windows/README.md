# 🖥️ Guide de Setup — Assurance Toto sur Windows 11 (Gemma 8B / Qwen2.5 7B)

Ce dossier contient tout ce qu'il faut pour installer et lancer le jumeau numérique **Assurance Toto**
sur un PC Windows 11 équipé de modèles locaux légers (Gemma 8B ou Qwen2.5 7B) et de VS Code / OpenCode.

> ⚠️ Ce dossier est complémentaire au projet principal (`assurance-toto-jumeau-numerique-COMPLET.zip`).
> Il contient les fichiers de configuration adaptés à un matériel modeste (7-8B, pas de gros GPU), 
> le guide d'installation pas-à-pas, et les scripts de diagnostic.

## 📋 Contenu de ce dossier

| Fichier | Rôle |
|---|---|
| `INSTALL-WINDOWS11.md` | Guide d'installation complet pas-à-pas (WSL2, Docker, Ollama, VS Code) |
| `CHANGELOG-SETUP.md` | Historique des versions de ce guide de setup |
| `.env.lite.example` | Variables d'environnement pré-remplies pour Gemma 8B / Qwen2.5 7B |
| `docker-compose.lite.yml` | Version allégée à 4 agents (Orchestrateur, Sales, Souscription, Sinistres) |
| `TROUBLESHOOTING.md` | Erreurs fréquentes Windows/WSL2/Ollama/Hermes et leurs solutions |
| `scripts/check-ram-vram.ps1` | Script PowerShell de vérification des ressources disponibles |
| `scripts/ollama-context-test.ps1` | Test de tenue du contexte 64K avec ton modèle local |
| `.vscode/settings.json` | Configuration VS Code recommandée (extension WSL, terminal par défaut) |
| `.vscode/extensions.json` | Extensions VS Code recommandées |

## 🚀 Ordre d'utilisation recommandé

1. Lire `INSTALL-WINDOWS11.md` du début à la fin.
2. Exécuter `scripts/check-ram-vram.ps1` pour valider que ta machine tient la charge.
3. Copier `.env.lite.example` vers `.env` dans le dossier du projet principal, l'adapter.
4. Remplacer `docker-compose.yml` du projet principal par `docker-compose.lite.yml` (ou fusionner).
5. Exécuter `scripts/ollama-context-test.ps1` pour valider le contexte 64K avant de lancer Hermes.
6. En cas de blocage, consulter `TROUBLESHOOTING.md`.

## 🧠 Rappel matériel minimum constaté

| Modèle | RAM système recommandée | VRAM GPU (si dispo) | Contexte max tenable réaliste |
|---|---|---|---|
| Qwen2.5 7B (Q4_K_M) | 16 Go | 8 Go | 32K-48K tokens |
| Gemma 8B (Q4_K_M) | 16 Go | 8-10 Go | 32K-48K tokens |

Hermes recommande 64K tokens de contexte minimum — sur un setup 7-8B/16 Go RAM, commence à 32K et augmente progressivement si stable.

## **Supervision & Vue CEO**

Si vous êtes CEO et souhaitez une vue d'ensemble rapide et opérationnelle :

- **Accès aux interfaces web clés** :
	- Gitea (code / dépôts) : http://localhost:3000
	- Rocket.Chat (communication) : http://localhost:3001
	- MailHog (emails envoyés par l'app) : http://localhost:8025

- **Vérifier l'état des services** (depuis la racine du projet) :
```bash
docker compose -f docker-compose.lite.yml ps
```

- **Suivre les logs des agents en temps réel** :
```bash
docker compose -f docker-compose.lite.yml logs -f agent-orchestrateur
docker compose -f docker-compose.lite.yml logs -f agent-sales
```

- **Redémarrer un agent si nécessaire** :
```bash
docker compose -f docker-compose.lite.yml restart agent-sales
```

- **Ressources et performances** (aperçu) :
```bash
docker stats --no-stream
```

- **Vérification de builds / images** :
```bash
docker images | grep assurance-toto
```

Notes rapides :
- Les agents s'exécutent en mode headless (`hermes run --headless`). Leur comportement opérationnel (ex. décisions d'escalade) est enregistré dans les logs du conteneur. Pour audits et revue, exporter les logs ou configurer une intégration centralisée (ELK/Prometheus/Grafana) est recommandé.
- J'ai ajouté un script d'aide `scripts/fix-docker-creds.sh` pour résoudre les erreurs de credential helpers lors du pull d'images.

