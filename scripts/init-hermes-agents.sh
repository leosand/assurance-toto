#!/usr/bin/env bash
# scripts/init-hermes-agents.sh — Starts and configures the 9 Hermes agents
set -e
export $(grep -v '^#' .env | xargs)

AGENTS=(orchestrateur sales souscription sinistres-contentieux support finance marketing rh conformite-it)

for agent in "${AGENTS[@]}"; do
  echo "🤖 Starting agent-$agent..."
  docker compose up -d "agent-$agent"
done

echo "⏳ Waiting for agent initialization (Plus memory, Ollama connection)..."
sleep 15

for agent in "${AGENTS[@]}"; do
  status=$(docker inspect -f '{{.State.Status}}' "toto-agent-${agent//-/}" 2>/dev/null || echo "unknown")
  echo "  - agent-$agent: $status"
done

echo "✅ The 9 Hermes agents are started. Check the logs: docker compose logs -f agent-orchestrateur"
