#!/usr/bin/env bash
# scripts/reset.sh — Réinitialise complètement l'environnement (⚠️ supprime toutes les données)
read -p "⚠️  Ceci va supprimer TOUTES les données (Postgres, Gitea, mémoire agents). Continuer ? [y/N] " confirm
if [[ "$confirm" == "y" ]]; then
  docker compose down -v
  echo "✅ Environnement réinitialisé."
else
  echo "Annulé."
fi
