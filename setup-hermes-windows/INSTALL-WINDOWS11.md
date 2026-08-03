# 🛠️ Full Installation — Hermes + Assurance Toto on Windows 11

## Prerequisites
- Windows 11 (up-to-date build)
- 16 GB RAM minimum (24-32 GB recommended for comfortable use with several agents)
- 20 GB free disk space minimum
- Windows administrator account

---

## Step 1 — Enable WSL2

Open PowerShell **as administrator**:

```powershell
wsl --install
wsl --set-default-version 2
```

Restart the PC. On first boot, Ubuntu opens automatically — create a Linux username and password (not to be confused with the Windows account).

Verify the installation
```powershell
wsl --status
wsl -l -v
```
The distribution must show `VERSION 2` and state 'Running'.

---

## Step 2 Install Docker Desktop

1. Download Docker Desktop from the official Docker website.
2. During installation, check **"Use WSL 2 instead Hyper-V"**.
3. Once installed, open Docker Desktop → Settings → General → verify that **"Use WSL 2 based engine"** is enabled.
4. Settings → Resources → WSL Integration → enable integration with your Ubuntu distribution.
5. Restart Docker Desktop.

Verify in a WSL2 terminal (Ubuntu):
```bash
docker --version
docker compose version
```

---

## Step 3 Install Ollama on Windows

1. Download the Ollama installer for Windows from ollama.com.
2. Install normally (no need to install it separately in WSL2 — Ollama on Windows already exposes `localhost:11434`, accessible from WSL2 and Docker Desktop).




[System.Environment]::SetEnvironmentVariable('OLLAMA_CONTEXT_LENGTH', '65536',





qwen2.5-coder:7b





qwen2.5-coder:7b "Bonjour, réponds en une phrase."
```

---

## Step 4 — Install Git (if missing)

```powershell
winget install --id Git.Git -e --source winget
```
Verify from WSL2:
```bash
git --version
```

---

## Step 5 Install VS Code + WSL extension

1. Install VS Code from code.visualstudio.com (choose the classic Windows version, no need for a separate WSL version).
2. Open VS Code → Extensions → install **"WSL"** (ms-vscode-remote.remote-wsl).
3. Open the command palette (`Ctrl+Shift+P`) → type "WSL: Connect WSL" → select Ubuntu.
4. Once connected, open the project folder cloned in WSL2:
`File → Open Folder → \\wsl.localhost\Ubuntu\home\<user>\assurance-toto`
5. The VS Code integrated terminal (`Ctrl+\``) then opens directly in the WSL2/Linux environment.

Optional if you use **OpenCode** alongside VS Code: configure it to point to the same Ollama endpoint (`http://localhost:11434/v1`), to avoid loading the model into memory twice at the same time.

---

## Step 6 Clone the project and prepare the environment

In the WSL2 terminal (via VS Code or Ubuntu directly):

```bash
cd ~
git clone <url-or-local-project-path> assurance-toto
cd assurance-toto

#Rather than cloning the project, we'll copy it from the Ubuntu terminal:
``` bash
cd "/mnt/e/Mes apps/assurance-toto"

cp .env.example .env
.env VS


`.env`,

OLLAMA_MODEL_PRIMARY=qwen2.5-coder:7b
OLLAMA_MODEL_FALLBACK=gemma4-12b
OLLAMA_CONTEXT_SIZE=32768
OLLAMA_HOST=http://host.docker.internal:11434


WSL2/Docker `host.docker.internal` `ollama:11434`



7 (4

`docker-compose.lite.yml`
`agent-orchestrateur`
`agent-sales`
- `agent-souscription`
- `agent-sinistres-contentieux`

```bash
docker compose -f docker-compose.lite.yml up -d postgres redis gitea
docker compose -f docker-compose.lite.yml up -d searxng mailhog rocketchat mcp-git
docker compose -f docker-compose.lite.yml up -d agent-orchestrateur
sleep 20
docker compose -f docker-compose.lite.yml up -d agent-sales agent-souscription agent-sinistres-contentieux
```

Monitor the Windows Task Manager (RAM/CPU) during the first 15-20 minutes.

---

## Step 8 — Scale up progressively

Once the 4-agent pipeline is stable, add one agent at a time:
```bash
docker compose up -d agent-finance
# monitor, then
docker compose up -d agent-support
# etc.
```

Never start all 9 agents simultaneously on a 7-8B/16 GB RAM setup.
