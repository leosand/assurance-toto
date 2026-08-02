#!/usr/bin/env bash
# scripts/bootstrap.sh — Initialise l'environnement de démo du jumeau numérique
# Cible le profil complet docker-compose.yml (8 agents) ; adaptez avec
# COMPOSE_FILE=docker-compose.lite.yml pour le MVP à 4 agents.
set -e

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file .env)

echo "🔧 Bootstrap Assurance Toto — démarrage (compose: $COMPOSE_FILE)..."

if [ ! -f .env ]; then
  echo "❌ Fichier .env manquant. Copier .env.example vers .env et le renseigner."
  exit 1
fi

echo "🐳 Construction des images locales (agents Hermes, bridge, mcp-git)..."
"${COMPOSE[@]}" build

echo "🚀 Démarrage de l'infrastructure de base (Postgres, Redis, Gitea)..."
"${COMPOSE[@]}" up -d postgres redis gitea

echo "⏳ Attente disponibilité Postgres..."
until docker exec toto-postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; do
  sleep 2
done
echo "✅ Postgres prêt."

# Ollama est NATIF sur l'hôte Windows (pas de conteneur) : les modèles sont
# pré-téléchargés côté hôte (`ollama pull gemma4:e4b` etc.), rien à faire ici.

echo "🗄️  Initialisation Gitea (attente disponibilité)..."
until curl -fsS http://localhost:3000 >/dev/null 2>&1; do
  sleep 2
done
echo "✅ Gitea prêt sur http://localhost:3000 — créer manuellement l'organisation 'toto'"
echo "   et le repo 'assurance-toto' au premier lancement, puis générer un token et"
echo "   le coller dans GITEA_ACCESS_TOKEN (.env)."

echo "📦 Démarrage des services complémentaires..."
"${COMPOSE[@]}" up -d searxng mailhog mcp-git presidio-analyzer minio minio-init postgres-buzz

echo "📡 Démarrage du sous-système Buzz (relais + bridge)..."
"${COMPOSE[@]}" up -d buzz buzz-hermes-bridge

echo "🤖 Démarrage des agents Hermes..."
"${COMPOSE[@]}" up -d

echo "✅ Stack démarrée. Points d'accès :"
echo "   - Cockpit Buzz (relais)  : http://localhost:3002"
echo "   - Bridge (santé)         : http://localhost:3100/healthz"
echo "   - Gitea                  : http://localhost:3000"
echo "   - MailHog                : http://localhost:8025"
echo "   - MinIO console          : http://localhost:9001"
echo ""
echo "Prochaine étape : ./scripts/seed-data.sh puis ./scripts/init-hermes-agents.sh"
