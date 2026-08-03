# 🔧 Troubleshooting — Hermes + Assurance Toto on Windows 11

## "wsl : le terme n'est pas reconnu" (PowerShell)
Your Windows 11 version doesn't have WSL enabled. Check `Windows Update` then run `wsl --install` again.
A restart is mandatory after installation.

## Docker Desktop won't start / "WSL2 kernel outdated"
```powershell
wsl --update
```
Then restart Docker Desktop.

## "Cannot connect to the Docker daemon" from WSL2
Check in Docker Desktop → Settings → Resources → WSL Integration that your Ubuntu distribution is ticked. Restart WSL2:
```powershell
wsl --shutdown
```
Then reopen Ubuntu.

## Hermes rejects tasks / "context too small" error
The Ollama context is too low. Check with:
```powershell
ollama show gemma4:e4b --modelfile # was: qwen2.5:7b
```
Look for `PARAMETER num_ctx`. If it's below 32768, force it via the `OLLAMA_CONTEXT_LENGTH=32768` environment variable before restarting `ollama serve`, or create a custom Modelfile:
```
FROM gemma4:e4b # was: qwen2.5:7b
PARAMETER num_ctx 32768
```
```powershell
ollama create gemma4-32k -f Modelfile # was: qwen2.5-32k
```
Then use `gemma4-32k` as `OLLAMA_MODEL_PRIMARY` in `.env`. # was: qwen2.5-32k

## Hermes agents are very slow / the PC becomes unusable
You probably launched too many agents at once with a single 7-8B model that processes requests one by one. Solution:
- Only use `docker-compose.lite.yml` (max 4 agents).
- Make sure only one agent at a time runs a heavy task (temporarily limit the others' cron).
- Consider lowering `OLLAMA_CONTEXT_SIZE` to 16384 if RAM is really tight (< 16 GB).

## "host.docker.internal" doesn't resolve from a container
On Docker Desktop for Windows, this DNS name is resolved automatically. If it fails, check your Docker Desktop version (update it) or temporarily replace it with the host machine's local IP (`ipconfig` → WSL address).

## Ollama eats all the RAM even when seemingly stopped
```powershell
ollama ps
ollama stop gemma4:e4b # was: qwen2.5:7b
```
Unloads the model from memory between work sessions.

## Gitea unreachable on localhost:3000
Make sure the container is actually running:
```bash
docker compose ps gitea
docker compose logs gitea
```
On first launch, Gitea must be initialized manually through the web interface (admin creation) before generating the access token for `.env`.

## VS Code doesn't show the WSL folder
Make sure the "WSL" extension (ms-vscode-remote.remote-wsl) is installed and up to date. Restart VS Code after installing it.
