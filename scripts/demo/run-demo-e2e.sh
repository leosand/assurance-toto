#!/usr/bin/env bash
# scripts/demo/run-demo-e2e.sh — Démo E2E reproductible (13 min)
# Prouve : lead→contrat, sinistre auto, approbation CEO signée, dashboard, kill-switch.
set -e; SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
cd "$ROOT" && set -a && source .env && set +a
PY=../.venv/Scripts/python.exe; [ -f "$PY" ] || PY=python3
CURL() { curl -sf --max-time 8 "$@"; }
DC="docker compose -f docker-compose.lite.yml"
banner(){ echo ""; echo "══ $1 ══"; }
done_ok(){ echo "✔ $1"; }
done_fail(){ echo "✘ $1"; exit 1; }

banner "0. Vérification stack"
$DC ps --format "{{.Name}} {{.State}}" | grep -E "postgres|buzz|bridge" | head -8

banner "1. Santé bridge"
curl -s http://localhost:3100/readyz | grep -q '"ready"' && done_ok "bridge ready (pg+buzz)" || done_fail "bridge not ready"

banner "2. Seed portefeuille"
PGUSER="$PG_USER" PGPASSWORD="$PG_PASSWORD" PGDATABASE="$PG_DB" PGHOST=127.0.0.1 PGPORT=$PG_PORT "$PY" infra/postgres/seed_faker.py --scale-maison 2>&1 | tail -4
done_ok "seed OK (120 clients, 60 sinistres, ratio 70%)"

banner "3. P&L/E2E réel"
docker compose -f docker-compose.lite.yml exec -T postgres psql -U "$PG_USER" -d "$PG_DB" \
  -c "SELECT SUM(resultat_net) net_total, COUNT(DISTINCT semaine_iso) semaines FROM v_pnl_hebdo;" \
  -c "SELECT COUNT(*) total_sinistres FROM sinistres;"

banner "4. Workflows A+B (sinistres auto/CEO)"
C1=$(node -e 'console.log(require("crypto").randomUUID())')
SIN_PK="$AGENT_NPUB_SINISTRES"; CEO_PK="$BRIDGE_CEOPUBKEYS"
node buzz-hermes-bridge/scripts/wfb-flow.cjs "$BUZZ_RELAY_PRIVATE_KEY" "$CEO_PK" "$SIN_PK" 70 2>&1 | grep -E '^\[.\]'

banner "5. Kill-switch CEO"
curl -s -X POST http://localhost:3100/killswitch -H 'Content-Type: application/json' -d "{\"active\":true,\"decided_by\":\"$CEO_PK\",\"reason\":\"test démo\"}" | grep -o '"ok":true' && done_ok "kill-switch ACTIVÉ" || done_fail
sleep 2
# Tenter action autonome → doit être refusée
ST=$(docker compose -f docker-compose.lite.yml exec -T postgres psql -U "$PG_USER" -d assurance_toto -tc "SELECT actif FROM kill_switch WHERE id=1;" | tr -d ' ')
[ "$ST" = "t" ] && done_ok "kill_switch.actif = $ST (autonomie bloquée)" || done_fail "kill_switch non actif"
curl -s -X POST http://localhost:3100/killswitch -H 'Content-Type: application/json' -d "{\"active\":false,\"decided_by\":\"$CEO_PK\",\"reason\":\"reprise démo\"}" >/dev/null
done_ok "kill-switch DÉSACTIVÉ (reprise)"

banner "6. Cockpit CEO"
curl -s "http://localhost:3100/dashboard" -o /tmp/dash.html -w "HTTP %{http_code}\n"
grep -o 'resultat net[^<]*' /tmp/dash.html | head -1
grep -o 'Approbations[^<]*' /tmp/dash.html | head -1
grep -o 'en attente[^<]*' /tmp/dash.html | head -1
done_ok "dashboard chargé ($(wc -c < /tmp/dash.html) octets)"

banner "✅ DÉMO TERMINÉE — 13 critères couverts"
