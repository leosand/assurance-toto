#!/usr/bin/env bash
# scripts/healthcheck.sh — État de santé par service, fail-fast.
# Usage : ./scripts/healthcheck.sh [--all]
# sans option : vérifie les services cœur (postgres, buzz, bridge, presidio).
# --all : inclut les agents et mcp-git.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
. "$SCRIPT_DIR/_lib.sh"

lib_compose "$ROOT_DIR"
FULL=0
[ "${1:-}" = "--all" ] && FULL=1

FAIL=0
report() {
  local name="$1" status="$2" detail="${3:-}"
  if [ "$status" = "ok" ]; then
    printf '%s[OK]%s   %-24s %s\n' "$C_GREEN" "$C_RST" "$name" "$detail"
  else
    printf '%s[DOWN]%s %-24s %s\n' "$C_RED" "$C_RST" "$name" "$detail"
    FAIL=$((FAIL + 1))
  fi
}

banner "healthcheck — ${COMPOSE_FILE}"

# --- postgres métier ---
if "${DC[@]}" exec -T postgres pg_isready -U "${PG_USER:-toto}" -d "${PG_DB:-assurance_toto}" >/dev/null 2>&1; then
  report postgres ok "pg_isready"
else
  report postgres down "pg_isready KO"
fi

# --- buzz relay ---
BUZZ_URL="${BUZZ_HEALTH_URL:-http://localhost:8081/health}"
code="$(http_code "$BUZZ_URL" 2>/dev/null)"
if [ "$code" = "200" ]; then
  report buzz ok "$BUZZ_URL → $code"
else
  report buzz down "$BUZZ_URL → $code"
fi

# --- buzz-hermes-bridge ---
BRIDGE_BASE="${BRIDGE_URL:-http://localhost:3100}"
if http_has "$BRIDGE_BASE/readyz" "ready"; then
  report bridge ok "$BRIDGE_BASE/readyz"
else
  report bridge down "$BRIDGE_BASE/readyz"
fi

# --- presidio ---
PRESIDIO_URL="${PRESIDIO_URL:-http://localhost:3003/health}"
code="$(http_code "$PRESIDIO_URL" 2>/dev/null)"
if [ "$code" = "200" ] || [ "$code" = "302" ]; then
  # presidio-analyzer n'a pas d'endpoint /health public ; 302/200 = up
  report presidio ok "$PRESIDIO_URL → $code"
else
  report presidio down "$PRESIDIO_URL → $code"
fi

if [ "$FULL" -eq 1 ]; then
  # --- 4 agents (lite) ---
  for svc in agent-orchestrateur agent-sales agent-souscription agent-sinistres-contentieux; do
    if "${DC[@]}" exec -T "$svc" sh -c 'wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1' 2>/dev/null; then
      report "$svc" ok "healthz interne ok"
    else
      report "$svc" down "healthy KO"
    fi
  done
  # --- mcp-git ---
  if "${DC[@]}" ps --status running --services 2>/dev/null | grep -qx 'mcp-git'; then
    report mcp-git ok "service running"
  else
    report mcp-git down "service absent/stoppé"
  fi
fi

printf '\n'
if [ "$FAIL" -eq 0 ]; then
  log_ok "Healthcheck OK — 0 service en échec."
  exit 0
else
  log_err "Healthcheck KO — $FAIL service(s) en échec."
  exit 1
fi
