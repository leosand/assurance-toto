#!/usr/bin/env bash
# scripts/seed.sh — postgres stack up + seed --scale-maison + verification.
#
# Usage:
#   ./scripts/seed.sh           # ~120 clients / 200 contracts / 60 claims
#   ./scripts/seed.sh large     # 5000 clients / 3000 contracts / 800 claims
#
# The seed runs in a one-shot python:3.12-slim container attached to the
# compose network (proven method from scripts/seed-data.sh). If the
# COMPOSE_NETWORK variable is not defined, we derive it from the `name:` of the compose
# (assurance-toto-lite) + `_net-core`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

lib_compose "$ROOT_DIR"
load_env_file "$ROOT_DIR/.env" 2>/dev/null || die ".env missing — cp .env.example .env then complete."

require_env PG_USER PG_PASSWORD PG_DB

banner "seed.sh — profile ${COMPOSE_FILE}"

# 1) Postgres up (idempotent)
log_info "docker compose up -d postgres…"
"${DC[@]}" up -d postgres >/dev/null

log_info "Waiting for pg_isready…"
for _ in $(seq 1 30); do
  if "${DC[@]}" exec -T postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
"${DC[@]}" exec -T postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null \
  || die "postgres is not ready after 60s"
log_ok "postgres ready."

# 2) Seed
SEED_ARGS="--scale-maison"
SEED_LABEL="scale-maison (~120 clients / 200 contracts / 60 claims)"
if [ "${1:-}" = "large" ]; then
  SEED_ARGS="--clients 5000 --contrats 3000 --sinistres 800"
  SEED_LABEL="large volume (5000/3000/800)"
fi

NETWORK="${COMPOSE_NETWORK:-assurance-toto-lite_net-core}"
log_info "Seed $SEED_LABEL via network $NETWORK…"
docker run --rm --network "$NETWORK" \
  -e PGHOST=postgres -e PGPORT=5432 \
  -e PGUSER="$PG_USER" -e PGPASSWORD="$PG_PASSWORD" -e PGDATABASE="$PG_DB" \
  -v "$ROOT_DIR/infra/postgres/seed_faker.py:/seed.py:ro" \
  python:3.12-slim bash -c "pip install --quiet faker psycopg2-binary && python /seed.py $SEED_ARGS"

# 3) Volume verification
log_info "Post-seed verification:"
for t in clients contrats sinistres pnl_ledger approbations audit_log; do
  n="$(psql_cell "SELECT COUNT(*) FROM $t;")"
  printf '  %-15s %s rows\n' "$t" "$n"
done
log_ok "seed.sh done."
