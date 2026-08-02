#!/usr/bin/env bash
# scripts/init-agents-env.sh — Fusionne .env.buzz dans .env.runtime (gitignored).
#
# Produit `.env.runtime` à la racine, sourcé par docker compose via
# `--env-file .env.runtime` (ou export shell) ; NE MODIFIE JAMAIS `.env`.
# - BRIDGE_CEOPUBKEYS            = CEO npub
# - BRIDGE_ALLOWED_UNSIGNED_ROLES= CSV des 4 npubs agents MVP
# - AGENT_NPUB_<ROLE> / AGENT_NSEC_<ROLE> : injectés tels quels aux services
#   agent-*. BUZZ_PRIVATE_KEY (bridge) reprend la paire AGENT_SINISTRES par
#   défaut (le bridge signe ses kind:9 sortantes avec une identité agent).
# - RELAY_OWNER_PUBKEY          = CEO npub (env attendu par le service buzz).
#
# Usage : ./scripts/init-agents-env.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

ENV_BUZZ="$ROOT_DIR/.env.buzz"
ENV_RUNTIME="$ROOT_DIR/.env.runtime"
ENV_BASE="$ROOT_DIR/.env"

[ -f "$ENV_BUZZ" ] || die ".env.buzz manquant — lance d'abord ./scripts/bootstrap-buzz.sh"
load_env_file "$ENV_BUZZ"

AGENT_ROLES=(ORCHESTRATEUR SALES SOUSCRIPTION SINISTRES)
csv_agents=""
for r in "${AGENT_ROLES[@]}"; do
  v="AGENT_${r}_NPUB_HEX"
  [ -n "${!v:-}" ] || die "Variable $v absente de .env.buzz"
  csv_agents="${csv_agents:+${csv_agents},}${!v}"
done

[ -n "${CEO_NPUB_HEX:-}" ] || die "CEO_NPUB_HEX absent de .env.buzz"

# Compose exige aussi les variables de base du projet : on les reprend telles
# quelles depuis .env (jamais modifié, jamais affiché) pour que
# `docker compose -f … --env-file .env.runtime` reste auto-suffisant.
{
  printf '# .env.runtime — généré le %s par scripts/init-agents-env.sh — NE PAS COMMITTER\n' "$(now_iso)"
  printf '# Base : valeurs reprises de .env (lecture seule)\n'
  if [ -f "$ENV_BASE" ]; then
    grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_BASE" | tr -d '\r'
  else
    log_warn ".env absent — .env.runtime ne contiendra que le bloc Nostr."
  fi
  printf '\n# --- Bloc Nostr dérivé de .env.buzz (régénéré à chaque run) ---\n'
  printf 'BRIDGE_CEOPUBKEYS=%s\n' "$CEO_NPUB_HEX"
  printf 'BRIDGE_ALLOWED_UNSIGNED_ROLES=%s\n' "$csv_agents"
  printf 'BRIDGE_REQUIRE_SIGNED_COMMANDS=false\n'
  printf 'CLAIM_SETTLEMENT_THRESHOLD_EUR=%s\n' "${CLAIM_SETTLEMENT_THRESHOLD_EUR:-5000}"
  printf 'RELAY_OWNER_PUBKEY=%s\n' "$CEO_NPUB_HEX"
  # Identité du bridge lui-même (signe les kind:9 sortantes) : npub hex/nsec hex.
  printf 'BUZZ_PRIVATE_KEY=%s\n' "${AGENT_SINISTRES_NSEC_HEX:-}"
  printf 'BUZZ_RELAY_PRIVATE_KEY=%s\n' "${AGENT_SINISTRES_NSEC_HEX:-}"
  for r in "${AGENT_ROLES[@]}"; do
    printf 'AGENT_NPUB_%s=%s\n' "$r" "$(eval "printf '%s' \"\${AGENT_${r}_NPUB_HEX}\"")"
    printf 'AGENT_NSEC_%s=%s\n' "$r" "$(eval "printf '%s' \"\${AGENT_${r}_NSEC_HEX}\"")"
  done
  # Alias Historique compose pour l'orchestrateur (AGENT_NPUB_ORCHESTRATEUR déjà couvert).
} >"$ENV_RUNTIME.tmp"
mv "$ENV_RUNTIME.tmp" "$ENV_RUNTIME"
chmod 600 "$ENV_RUNTIME" 2>/dev/null || true

log_ok "Écrit $ENV_RUNTIME (chmod 600)"
log_info "CEO        : $CEO_NPUB_HEX"
log_info "Agents     : $csv_agents"
log_info "Utilisation: docker compose -f $COMPOSE_FILE --env-file .env.runtime up -d"
