#!/usr/bin/env bash
# scripts/bootstrap.sh — Initialise l'environnement complet du jumeau numérique
set -e

echo "🔧 Bootstrap Assurance Toto — démarrage..."

if [ ! -f .env ]; then
  echo "❌ Fichier .env manquant. Copier .env.example vers .env et le renseigner."
  exit 1
fi
export $(grep -v '^#' .env | xargs)

echo "🐳 Construction des images Docker..."
docker compose build

echo "🚀 Démarrage de l'infrastructure de base (Postgres, Redis, Ollama, Gitea)..."
docker compose up -d postgres redis ollama gitea

echo "⏳ Attente disponibilité Postgres..."
until docker exec toto-postgres pg_isready -U "$PG_USER" > /dev/null 2>&1; do sleep 2; done
echo "✅ Postgres prêt."

echo "🧠 Téléchargement des modèles Ollama (gratuit, local)..."
docker exec toto-ollama ollama pull "$OLLAMA_MODEL_PRIMARY" || true
docker exec toto-ollama ollama pull "$OLLAMA_MODEL_FALLBACK" || true

echo "🗄️ Initialisation Gitea (attente disponibilité)..."
until curl -s http://localhost:3000 > /dev/null; do sleep 2; done
echo "✅ Gitea prêt sur http://localhost:3000 — créer manuellement l'organisation 'toto' et le repo 'assurance-toto' au premier lancement, puis générer un token et le coller dans GITEA_ACCESS_TOKEN (.env)."

echo "📦 Démarrage des MCP servers et services complémentaires..."
docker compose up -d searxng mailhog rocketchat twenty-crm mcp-postgres mcp-presidio mcp-git mcp-macro-wrapper gamification-engine

echo "✅ Bootstrap terminé. Prochaine étape : ./scripts/seed-data.sh puis ./scripts/init-hermes-agents.sh"
