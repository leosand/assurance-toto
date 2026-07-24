#!/usr/bin/env bash
# scripts/init-hermes-agents.sh — Démarre et configure les 9 agents Hermes
set -e
export $(grep -v '^#' .env | xargs)

AGENTS=(orchestrateur sales souscription sinistres-contentieux support finance marketing rh conformite-it)

for agent in "${AGENTS[@]}"; do
  echo "🤖 Démarrage agent-$agent..."
  docker compose up -d "agent-$agent"
done

echo "⏳ Attente initialisation des agents (mémoire Plur, connexion Ollama)..."
sleep 15

for agent in "${AGENTS[@]}"; do
  status=$(docker inspect -f '{{.State.Status}}' "toto-agent-${agent//-/}" 2>/dev/null || echo "unknown")
  echo "  - agent-$agent : $status"
done

echo "✅ Les 9 agents Hermes sont démarrés. Consulter les logs : docker compose logs -f agent-orchestrateur"
