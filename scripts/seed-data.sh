#!/usr/bin/env bash
# scripts/seed-data.sh — Génère les données synthétiques Faker fr_FR
set -e
export $(grep -v '^#' .env | xargs)

echo "🌱 Génération des données synthétiques (5000 clients, 3000 contrats, 800 sinistres)..."
docker run --rm --network assurance-toto_net-core \
  -e PG_HOST=postgres -e PG_DB="$PG_DB" -e PG_USER="$PG_USER" -e PG_PASSWORD="$PG_PASSWORD" \
  -v "$(pwd)/infra/postgres/seed_faker.py:/seed.py" \
  python:3.12-slim bash -c "pip install --quiet faker psycopg2-binary && python /seed.py"

echo "✅ Données synthétiques générées."
