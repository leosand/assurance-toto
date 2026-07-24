# 🛠️ Installation Complète — Hermes + Assurance Toto sur Windows 11

## Prérequis
- Windows 11 (build à jour)
- 16 Go RAM minimum (24-32 Go recommandé pour un usage confortable avec plusieurs agents)
- 20 Go d'espace disque libre minimum
- Compte administrateur Windows

---

## Étape 1 — Activer WSL2

Ouvrir PowerShell **en administrateur** :

```powershell
wsl --install
wsl --set-default-version 2
```

Redémarrer le PC. Au premier démarrage, Ubuntu s'ouvre automatiquement — créer un nom d'utilisateur et mot de passe Linux (à ne pas confondre avec le compte Windows).

Vérifier l'installation :
```powershell
wsl --status
wsl -l -v
```
La distribution doit afficher `VERSION 2` et state 'Running'.

---

## Étape 2 — Installer Docker Desktop

1. Télécharger Docker Desktop depuis le site officiel Docker.
2. Pendant l'installation, cocher **"Use WSL 2 instead of Hyper-V"**.
3. Une fois installé, ouvrir Docker Desktop → Settings → General → vérifier que **"Use the WSL 2 based engine"** est activé.
4. Settings → Resources → WSL Integration → activer l'intégration avec ta distribution Ubuntu.
5. Redémarrer Docker Desktop.

Vérifier dans un terminal WSL2 (Ubuntu) :
```bash
docker --version
docker compose version
```

---

## Étape 3 — Installer Ollama sur Windows

1. Télécharger l'installeur Ollama pour Windows depuis ollama.com.
2. Installer normalement (pas besoin de l'installer dans WSL2 séparément — Ollama sur Windows expose déjà `localhost:11434`, accessible depuis WSL2 et Docker Desktop).
3. Définir le contexte long avant de lancer le service :

```powershell
[System.Environment]::SetEnvironmentVariable('OLLAMA_CONTEXT_LENGTH', '65536', 'User')
```
Redémarrer le terminal, puis :
```powershell
ollama serve
```

4. Télécharger les modèles :
```powershell
ollama pull qwen2.5-coder:7b
ollama pull gemma4-12b
ollama pull hermes3-8b
```

5. Tester rapidement :
```powershell
ollama run qwen2.5-coder:7b "Bonjour, réponds en une phrase."
```

---

## Étape 4 — Installer Git (si absent)

```powershell
winget install --id Git.Git -e --source winget
```
Vérifier depuis WSL2 :
```bash
git --version
```

---

## Étape 5 — Installer VS Code + extension WSL

1. Installer VS Code depuis code.visualstudio.com (choisir la version Windows classique, pas besoin de la version WSL séparée).
2. Ouvrir VS Code → Extensions → installer **"WSL"** (ms-vscode-remote.remote-wsl).
3. Ouvrir la palette de commandes (`Ctrl+Shift+P`) → taper "WSL: Connect to WSL" → sélectionner Ubuntu.
4. Une fois connecté, ouvrir le dossier du projet cloné dans WSL2 :
   `File → Open Folder → \\wsl.localhost\Ubuntu\home\<utilisateur>\assurance-toto`
5. Le terminal intégré de VS Code (`Ctrl+\``) s'ouvre alors directement dans l'environnement WSL2/Linux.

Optionnel — si tu utilises **OpenCode** en complément de VS Code : configure-le pour pointer sur le même endpoint Ollama (`http://localhost:11434/v1`), afin d'éviter de charger le modèle deux fois en mémoire simultanément.

---

## Étape 6 — Cloner le projet et préparer l'environnement

Dans le terminal WSL2 (via VS Code ou Ubuntu direct) :

```bash
cd ~
git clone <url-ou-chemin-local-du-projet> assurance-toto
cd assurance-toto

#Plutôt que de cloner le projet, on va le copier dans terminal sous ubuntu:
``` bash
cd "/mnt/e/Mes apps/assurance-toto"

cp .env.example .env
nano .env   # ou éditer directement dans VS Code
```

Dans `.env`, remplacer :
```
OLLAMA_MODEL_PRIMARY=qwen2.5-coder:7b
OLLAMA_MODEL_FALLBACK=gemma4-12b
OLLAMA_CONTEXT_SIZE=32768
OLLAMA_HOST=http://host.docker.internal:11434
```

> ⚠️ Sous WSL2/Docker Desktop, Ollama tournant sur Windows est accessible via `host.docker.internal` et non `ollama:11434` (qui suppose un conteneur Ollama dédié — inutile ici puisqu'Ollama tourne déjà nativement sur Windows).

---

## Étape 7 — Version allégée (4 agents) pour valider le pipeline

Copier `docker-compose.lite.yml` à la racine du projet, qui ne démarre que :
- `agent-orchestrateur`
- `agent-sales`
- `agent-souscription`
- `agent-sinistres-contentieux`

```bash
docker compose -f docker-compose.lite.yml up -d postgres redis gitea
docker compose -f docker-compose.lite.yml up -d searxng mailhog rocketchat mcp-git
docker compose -f docker-compose.lite.yml up -d agent-orchestrateur
sleep 20
docker compose -f docker-compose.lite.yml up -d agent-sales agent-souscription agent-sinistres-contentieux
```

Observer le Gestionnaire des tâches Windows (RAM/CPU) pendant les 15-20 premières minutes.

---

## Étape 8 — Étendre progressivement

Une fois le pipeline à 4 agents stable, ajouter un agent à la fois :
```bash
docker compose up -d agent-finance
# observer, puis
docker compose up -d agent-support
# etc.
```

Ne jamais démarrer les 9 agents simultanément sur un setup 7-8B/16 Go RAM.
