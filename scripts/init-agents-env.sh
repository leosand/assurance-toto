#!/usr/bin/env bash
# scripts/init-agents-env.sh — Merges .env.buzz into .env.runtime (gitignored).
#
# Produces `.env.runtime` at the root, sourced by docker compose via
# `--env-file .env.runtime` (or shell export); NEVER MODIFIES `.env`.
# - BRIDGE_CEOPUBKEYS             = CEO npub
# - BRIDGE_ALLOWED_UNSIGNED_ROLES = CSV of the 4 MVP agent npubs
# - AGENT_NPUB_<ROLE> / AGENT_NSEC_<ROLE> : injected as-is to the
#   agent-* services. BUZZ_PRIVATE_KEY (bridge) takes the AGENT_SINISTRES pair by
#   default (the bridge signs its outgoing kind:9 with an agent identity).
# - RELAY_OWNER_PUBKEY            = CEO npub (env expected by the buzz service).
#
# Usage: ./scripts/init-agents-env.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

ENV_BUZZ="$ROOT_DIR/.env.buzz"
ENV_RUNTIME="$ROOT_DIR/.env.runtime"
ENV_BASE="$ROOT_DIR/.env"

[ -f "$ENV_BUZZ" ] || die ".env.buzz missing — run ./scripts/bootstrap-buzz.sh first"
load_env_file "$ENV_BUZZ"

AGENT_ROLES=(ORCHESTRATEUR SALES SOUSCRIPTION SINISTRES)
csv_agents=""
for r in "${AGENT_ROLES[@]}"; do
  v="AGENT_${r}_NPUB_HEX"
  [ -n "${!v:-}" ] || die "Variable $v absent from .env.buzz"
  csv_agents="${csv_agents:+${csv_agents},}${!v}"
done

[ -n "${CEO_NPUB_HEX:-}" ] || die "CEO_NPUB_HEX absent from .env.buzz"

# Compose also requires the project base variables: we take them back
# as-is from .env (never modified, never displayed) so that
# `docker compose -f … --env-file .env.runtime` remains self-sufficient.
{
  printf '# .env.runtime — generated on %s by scripts/init-agents-env.sh — DO NOT COMMIT\n' "$(now_iso)"
  printf '# Base: values copied from .env (read-only)\n'
  if [ -f "$ENV_BASE" ]; then
    grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_BASE" | tr -d '\r'
  else
    log_warn ".env absent — .env.runtime will only contain the Nostr block."
  fi
  printf '\n# --- Nostr block derived from .env.buzz (regenerated on each run) ---\n'
  printf 'BRIDGE_CEOPUBKEYS=%s\n' "$CEO_NPUB_HEX"
  printf 'BRIDGE_ALLOWED_UNSIGNED_ROLES=%s\n' "$csv_agents"
  printf 'BRIDGE_REQUIRE_SIGNED_COMMANDS=false\n'
  printf 'CLAIM_SETTLEMENT_THRESHOLD_EUR=%s\n' "${CLAIM_SETTLEMENT_THRESHOLD_EUR:-5000}"
  printf 'RELAY_OWNER_PUBKEY=%s\n' "$CEO_NPUB_HEX"
  # Bridge identity itself (signs the outgoing kind:9): hex npub/hex nsec.
  printf 'BUZZ_PRIVATE_KEY=%s\n' "${AGENT_SINISTRES_NSEC_HEX:-}"
  printf 'BUZZ_RELAY_PRIVATE_KEY=%s\n' "${AGENT_SINISTRES_NSEC_HEX:-}"
  for r in "${AGENT_ROLES[@]}"; do
    printf 'AGENT_NPUB_%s=%s\n' "$r" "$(eval "printf '%s' \"\${AGENT_${r}_NPUB_HEX}\"")"
    printf 'AGENT_NSEC_%s=%s\n' "$r" "$(eval "printf '%s' \"\${AGENT_${r}_NSEC_HEX}\"")"
  done
  # Historical compose alias for the orchestrator (AGENT_NPUB_ORCHESTRATEUR already covered).
} >"$ENV_RUNTIME.tmp"
mv "$ENV_RUNTIME.tmp" "$ENV_RUNTIME"
chmod 600 "$ENV_RUNTIME" 2>/dev/null || true

log_ok "Wrote $ENV_RUNTIME (chmod 600)"
log_info "CEO        : $CEO_NPUB_HEX"
log_info "Agents     : $csv_agents"
log_info "Usage: docker compose -f $COMPOSE_FILE --env-file .env.runtime up -d"
