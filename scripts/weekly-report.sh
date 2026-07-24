#!/usr/bin/env bash
# scripts/weekly-report.sh — Déclenche manuellement le calcul du rapport hebdomadaire (hors cron)
set -e
echo "📊 Génération manuelle du rapport hebdomadaire..."
docker compose run --rm gamification-engine python pnl_calculator.py
echo "✅ Rapport généré dans ./reports/latest.md"
cat reports/latest.md
