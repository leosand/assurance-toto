#!/usr/bin/env bash
# scripts/seed-data.sh — Generates the synthetic Faker fr_FR data
#
# Usage:
#   ./scripts/seed-data.sh            # coherent demo portfolio (--scale-maison)
#   ./scripts/seed-data.sh large      # large volume: 5000 clients / 3000 contracts / 800 claims
#
# PGVECTOR PREREQUISITE: the v2 schema requires the `vector` extension
# (init_extensions.sql) => use the `pgvector/pgvector:pg16` image for
# the postgres service instead of `postgres:16-alpine` (the alpine image does not provide
# it). Without pgvector, schema_v2.sql fails on the embedding vector(768)
# column and the HNSW index. The compose wiring is a separate ticket.
set -e
export $(grep -v '^#' .env | xargs)

SEED_ARGS="--scale-maison"
SEED_LABEL="scale-maison (~120 clients, 200 contracts, 60 claims, ratio ~70 %)"
if [ "$1" = "large" ]; then
  SEED_ARGS="--clients 5000 --contrats 3000 --sinistres 800"
  SEED_LABEL="large volume (5000 clients, 3000 contracts, 800 claims)"
fi

echo "📊 Generating synthetic data ($SEED_LABEL)..."
# The lite file declares name: assurance-toto-lite ⇒ the internal network
# is assurance-toto-lite_net-core (the compose service is named `postgres`).
docker run --rm --network assurance-toto-lite_net-core \
  -e PGHOST=postgres -e PGPORT=5432 \
  -e PGUSER="$PG_USER" -e PGPASSWORD="$PG_PASSWORD" -e PGDATABASE="$PG_DB" \
  -v "$(pwd)/infra/postgres/seed_faker.py:/seed.py" \
  python:3.12-slim bash -c "pip install --quiet faker psycopg2-binary && python /seed.py $SEED_ARGS"

echo "✅ Synthetic data generated."
