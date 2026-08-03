#!/usr/bin/env bash
# scripts/weekly-report.sh — Manually triggers the weekly report computation (outside cron)
set -e
echo "📊 Manual generation of the weekly report..."
docker compose run --rm gamification-engine python pnl_calculator.py
echo "✅ Report generated in ./reports/latest.md"
cat reports/latest.md
