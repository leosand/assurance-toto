#!/usr/bin/env bash
# scripts/bootstrap.sh — Initializes the demo environment of the digital twin
# Targets the full profile docker-compose.yml (8 agents); adapt with
# COMPOSE_FILE=docker-compose.lite.yml for the 4-agent MVP.
set -e

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file .env)

echo "🔧 Assurance Toto bootstrap — starting (compose: $COMPOSE_FILE)..."

if [ ! -f .env ]; then
  echo "❌ Missing .env file. Copy .env.example to .env and fill it in."
  exit 1
fi

echo "🔨 Building local images (Hermes agents, bridge, mcp-git)..."
"${COMPOSE[@]}" build

echo "🔌 Starting the base infrastructure (Postgres, Redis, Gitea)..."
"${COMPOSE[@]}" up -d postgres redis gitea

echo "⏳ Waiting for Postgres availability..."
until docker exec toto-postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; do
  sleep 2
done
echo "✅ Postgres ready."

# Ollama is NATIVE on the Windows host (no container): the models are
# pre-pulled on the host side (`ollama pull gemma4:e4b` etc.), nothing to do here.

echo "🔧 Gitea initialization (waiting for availability)..."
until curl -fsS http://localhost:3000 >/dev/null 2>&1; do
  sleep 2
done
echo "✅ Gitea ready on http://localhost:3000 — manually create the 'toto' organization"
echo "   and the 'assurance-toto' repo on first run, then generate a token and"
echo "   paste it into GITEA_ACCESS_TOKEN (.env)."

echo "🚀 Starting complementary services..."
"${COMPOSE[@]}" up -d searxng mailhog mcp-git presidio-analyzer minio minio-init postgres-buzz

echo "🔀 Starting the Buzz subsystem (relay + bridge)..."
"${COMPOSE[@]}" up -d buzz buzz-hermes-bridge

echo "🤖 Starting the Hermes agents..."
"${COMPOSE[@]}" up -d

echo "✅ Stack started. Access points:"
echo "   - Buzz cockpit (relay)  : http://localhost:3002"
echo "   - Bridge (health)       : http://localhost:3100/healthz"
echo "   - Gitea                 : http://localhost:3000"
echo "   - MailHog               : http://localhost:8025"
echo "   - MinIO console         : http://localhost:9001"
echo ""
echo "Next step: ./scripts/seed-data.sh then ./scripts/init-hermes-agents.sh"
