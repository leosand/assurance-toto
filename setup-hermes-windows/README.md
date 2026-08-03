# 🖥️ Setup Guide — Assurance Toto on Windows 11 (Gemma 8B / Qwen2.5 7B)

This folder contains everything needed to install and run the **Assurance Toto** digital twin
on a Windows 11 PC equipped with lightweight local models (Gemma 8B or Qwen2.5 7B) and VS Code / OpenCode.

> ⚠️ This folder complements the main project (`assurance-toto-jumeau-numerique-COMPLET.zip`).
> It contains configuration files adapted to modest hardware (7-8B, no large GPU),
> the step-by-step installation guide, and diagnostic scripts.

## 📋 Folder contents

| File | Role |
|---|---|
| `INSTALL-WINDOWS11.md` | Complete step-by-step installation guide (WSL2, Docker, Ollama, VS Code) |
| `CHANGELOG-SETUP.md` | Version history of this setup guide |
| `.env.lite.example` | Pre-filled environment variables for Gemma 8B / Qwen2.5 7B |
| `docker-compose.lite.yml` | Lightweight 4-agent version (Orchestrator, Sales, Underwriting, Claims) |
| `TROUBLESHOOTING.md` | Common Windows/WSL2/Ollama/Hermes errors and their solutions |
| `scripts/check-ram-vram.ps1` | PowerShell script to check available resources |
| `scripts/ollama-context-test.ps1` | 64K context endurance test with your local model |
| `.vscode/settings.json` | Recommended VS Code configuration (WSL extension, default terminal) |
| `.vscode/extensions.json` | Recommended VS Code extensions |

## 🚀 Recommended usage order

1. Read `INSTALL-WINDOWS11.md` from start to finish.
2. Run `scripts/check-ram-vram.ps1` to validate that your machine can handle the load.
3. Copy `.env.lite.example` to `.env` in the main project folder, then adapt it.
4. Replace the main project's `docker-compose.yml` with `docker-compose.lite.yml` (or merge them).
5. Run `scripts/ollama-context-test.ps1` to validate the 64K context before launching Hermes.
6. If you get stuck, check `TROUBLESHOOTING.md`.

## 🧠 Minimum observed hardware reminder

| Model | Recommended system RAM | GPU VRAM (if available) | Realistic max context |
|---|---|---|---|
| Qwen2.5 7B (Q4_K_M) | 16 GB | 8 GB | 32K-48K tokens |
| Gemma 8B (Q4_K_M) | 16 GB | 8-10 GB | 32K-48K tokens |

Hermes recommends a minimum 64K token context — on a 7-8B/16 GB RAM setup, start at 32K and increase gradually if stable.

## **Supervision & CEO View**

If you are a CEO and want a quick, operational overview:

- **Access to key web interfaces**:
	- Gitea (code / repositories): http://localhost:3000
	- Rocket.Chat (communication): http://localhost:3001
	- MailHog (emails sent by the app): http://localhost:8025

- **Check service status** (from the project root):
```bash
docker compose -f docker-compose.lite.yml ps
```

- **Follow agent logs in real time**:
```bash
docker compose -f docker-compose.lite.yml logs -f agent-orchestrateur
docker compose -f docker-compose.lite.yml logs -f agent-sales
```

- **Restart an agent if needed**:
```bash
docker compose -f docker-compose.lite.yml restart agent-sales
```

- **Resources and performance** (overview):
```bash
docker stats --no-stream
```

- **Build / image verification**:
```bash
docker images | grep assurance-toto
```

Quick notes:
- Agents run in headless mode (`hermes run --headless`). Their operational behavior (e.g. escalation decisions) is recorded in the container logs. For audits and review, exporting logs or setting up a centralized integration (ELK/Prometheus/Grafana) is recommended.
- I added a helper script `scripts/fix-docker-creds.sh` to resolve credential helper errors when pulling images.
