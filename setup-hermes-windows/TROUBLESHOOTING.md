# 🔧 Troubleshooting — Hermes + Assurance Toto sur Windows 11

## "wsl : le terme n'est pas reconnu" (PowerShell)
Ta version de Windows 11 n'a pas WSL activé. Vérifier `Windows Update` puis relancer `wsl --install`.
Redémarrer impérativement après installation.

## Docker Desktop ne démarre pas / "WSL2 kernel outdated"
```powershell
wsl --update
```
Puis redémarrer Docker Desktop.

## "Cannot connect to the Docker daemon" depuis WSL2
Vérifier dans Docker Desktop → Settings → Resources → WSL Integration que ta distribution Ubuntu est bien cochée. Redémarrer WSL2 :
```powershell
wsl --shutdown
```
Puis rouvrir Ubuntu.

## Hermes rejette les tâches / erreur "context too small"
Le contexte Ollama est trop bas. Vérifier :
```powershell
ollama show qwen2.5:7b --modelfile
```
Chercher `PARAMETER num_ctx`. S'il est inférieur à 32768, forcer via variable d'environnement `OLLAMA_CONTEXT_LENGTH=32768` avant de relancer `ollama serve`, ou créer un Modelfile custom :
```
FROM qwen2.5:7b
PARAMETER num_ctx 32768
```
```powershell
ollama create qwen2.5-32k -f Modelfile
```
Puis utiliser `qwen2.5-32k` comme `OLLAMA_MODEL_PRIMARY` dans `.env`.

## Les agents Hermes sont très lents / le PC devient inutilisable
Tu as probablement lancé trop d'agents simultanément avec un seul modèle 7-8B qui traite les requêtes en file. Solution :
- N'utiliser que `docker-compose.lite.yml` (4 agents max).
- Vérifier qu'un seul agent à la fois exécute une tâche lourde (limiter le cron des autres temporairement).
- Envisager de réduire `OLLAMA_CONTEXT_SIZE` à 16384 si la RAM est vraiment limitée (< 16 Go).

## "host.docker.internal" ne résout pas depuis un conteneur
Sous Docker Desktop pour Windows, ce nom DNS est résolu automatiquement. Si ça échoue, vérifier la version de Docker Desktop (mettre à jour) ou remplacer temporairement par l'IP locale de la machine hôte (`ipconfig` → adresse WSL).

## Ollama consomme toute la RAM même à l'arrêt apparent
```powershell
ollama ps
ollama stop qwen2.5:7b
```
Pour libérer le modèle de la mémoire entre deux sessions de travail.

## Gitea inaccessible sur localhost:3000
Vérifier que le conteneur est bien démarré :
```bash
docker compose ps gitea
docker compose logs gitea
```
Au premier lancement, il faut initialiser Gitea manuellement via l'interface web (création admin) avant de générer le token d'accès pour `.env`.

## VS Code n'affiche pas le dossier WSL
Vérifier que l'extension "WSL" (ms-vscode-remote.remote-wsl) est bien installée et à jour. Redémarrer VS Code après installation.
