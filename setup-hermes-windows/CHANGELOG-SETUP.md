# Changelog — Guide de Setup Windows 11

## [1.0.2] — 2026-07-24

-### Ajouté
- **`hermes.config.json`** : Création du fichier de configuration Hermes pour les 4 agents (orchestrateur, sales, souscription, sinistres-contentieux) — requis par le `COPY` dans les Dockerfiles.
- **`security/mcp-allowlist.json`** : Création de la liste blanche MCP — monté en volume par chaque agent.
- **`infra/postgres/init.sql`** : Remplacement du dossier vide par un vrai fichier SQL avec le schéma initial (tables clients, contrats, sinistres, agent_actions).

### Corrigé
- **`docker-compose.lite.yml`** : Mis à jour pour utiliser des `Dockerfile` locaux (`agents/*/Dockerfile`) afin que `COPY hermes.config.json` et `COPY skills/` fonctionnent correctement dans le contexte de build.
- **Outils** : Ajout de `scripts/fix-docker-creds.sh` pour aider à corriger les problèmes de credential helper Docker qui empêchaient le pull/build des images.
 - **Fix** : Ajout d'un service `db` (MongoDB) requis par Rocket.Chat et mis à jour de la dépendance du service Rocke.Chat dans `docker-compose.lite.yml`.

## [1.0.1] — 2026-07-24

### Modifié & Corrigé
- **Modèles Ollama** : Alignement sur `qwen2.5-coder:7b` (primaire) et `gemma4-12b` (fallback).
- **`docker-compose.lite.yml`** : Retrait de la dépendance externe non résolue `mcp-postgres` sur les agents afin de permettre leur démarrage propre sans erreur de pull d'image distante.
- **`INSTALL-WINDOWS11.md`** : Correction de la séquence d'initialisation de l'étape 7 (retrait du script seed bloquant et suppression du paramètre `mcp-postgres`).

## [1.0.0] — 2026-07-23

### Ajouté
- Guide d'installation complet Windows 11 (WSL2 + Docker Desktop + Ollama + VS Code).
- Fichier `.env.lite.example` pré-configuré pour Gemma 4 12B / Qwen2.5-Coder 7B.
- `docker-compose.lite.yml` limité à 4 agents (Orchestrateur, Sales, Souscription, Sinistres-Contentieux).
- Scripts PowerShell de diagnostic (`check-ram-vram.ps1`, `ollama-context-test.ps1`).
- Fichier `TROUBLESHOOTING.md` couvrant les erreurs Windows/WSL2/Ollama/Hermes les plus fréquentes.
- Configuration VS Code recommandée (`.vscode/settings.json`, `.vscode/extensions.json`).

### Contexte
- Rédigé suite à confirmation du matériel utilisateur : Windows 11, Gemma 4 12B ou Qwen2.5-Coder 7B, VS Code/OpenCode.
- Objectif : permettre un démarrage progressif du jumeau numérique Assurance Toto sur un matériel grand public, sans GPU dédié puissant.
