#!/usr/bin/env bash
# scripts/seed-data.sh — Génère les données synthétiques Faker fr_FR
#
# Usage :
#   ./scripts/seed-data.sh                # portefeuille démo cohérent (--scale-maison)
#   ./scripts/seed-data.sh large          # gros volume : 5000 clients / 3000 contrats / 800 sinistres
#
# PRÉREQUIS pgvector : le schéma v2 requiert l'extension `vector`
# (init_extensions.sql) => utiliser l'image `pgvector/pgvector:pg16` pour le
# service postgres au lieu de `postgres:16-alpine` (l'image alpine ne la fournit
# pas). Sans pgvector, schema_v2.sql échoue sur la colonne embedding vector(768)
# et l'index HNSW. Le câblage compose est un ticket séparé.
set -e
export $(grep -v '^#' .env | xargs)

SEED_ARGS="--scale-maison"
SEED_LABEL="scale-maison (~120 clients, 200 contrats, 60 sinistres, ratio ~70 %)"
if [ "$1" = "large" ]; then
  SEED_ARGS="--clients 5000 --contrats 3000 --sinistres 800"
  SEED_LABEL="gros volume (5000 clients, 3000 contrats, 800 sinistres)"
fi

echo "🌱 Génération des données synthétiques ($SEED_LABEL)..."
# Le fichier lite déclare `name: assurance-toto-lite` ⇒ le réseau interne
# est assurance-toto-lite_net-core (le service compose s'appelle `postgres`).
docker run --rm --network assurance-toto-lite_net-core \
  -e PGHOST=postgres -e PGPORT=5432 \
  -e PGUSER="$PG_USER" -e PGPASSWORD="$PG_PASSWORD" -e PGDATABASE="$PG_DB" \
  -v "$(pwd)/infra/postgres/seed_faker.py:/seed.py" \
  python:3.12-slim bash -c "pip install --quiet faker psycopg2-binary && python /seed.py $SEED_ARGS"

echo "✅ Données synthétiques générées."
