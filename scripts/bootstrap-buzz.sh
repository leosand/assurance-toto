#!/usr/bin/env bash
# scripts/bootstrap-buzz.sh — Bootstrap of the Buzz subsystem (idempotent).
#
# Does, in order:
#   1. Wait for the buzz relay to answer on /health (host port 3002).
#   2. Generate the Nostr keypairs (CEO + 4 MVP agents) — by default with
#      `buzz-admin generate-key` in the buzz container; local fallback
#      on openssl if buzz-admin does not exist in the image.
#   3. Write/refresh `.env.buzz` (gitignored, chmod 600) at the repo root.
#   4. Register each npub via `buzz-admin add-member` (idempotent).
#   5. Channels: buzz-admin has NO create-channel sub-command (see
#      docs/OPERATOR.md §Buzz). Buzz instead creates channels on the 1st
#      kind:9 message carried by the bridge — this script only verifies that the relay
#      exposes them, and displays the linkage to init-agents-env.sh.
#
# Usage: ./scripts/bootstrap-buzz.sh [--reuse]
#   --reuse : reuse an existing .env.buzz without regenerating the keys.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

lib_compose "$ROOT_DIR"

ENV_BUZZ="$ROOT_DIR/.env.buzz"
BUZZ_HEALTH_URL="${BUZZ_HEALTH_URL:-http://localhost:3002/health}"
BUZZ_CONTAINER="${BUZZ_CONTAINER:-buzz}"
REUSE=0
[ "${1:-}" = "--reuse" ] && REUSE=1

banner "bootstrap-buzz — relay $BUZZ_HEALTH_URL"

# ---------- 1. Wait for the relay ----------
log_info "Waiting for the buzz relay…"
if ! wait_http "$BUZZ_HEALTH_URL" 90 200; then
  die "The buzz relay is not answering. Start first: ${COMPOSE_FILE} up -d buzz (with postgres-buzz, redis, minio-init)."
fi
log_ok "Buzz relay up."

# Verifies the admin binary in the container.
HAS_BUZZ_ADMIN=0
if "${DC[@]}" exec -T buzz sh -c 'command -v buzz-admin >/dev/null 2>&1' 2>/dev/null; then
  HAS_BUZZ_ADMIN=1
  log_ok "buzz-admin found in container $BUZZ_CONTAINER."
else
  log_warn "buzz-admin absent from the image — fall back to openssl for keys (valid Nostr hex, 64 chars)."
fi

# ---------- 2. Generation / reuse of keypairs ----------
ROLES=(CEO AGENT_ORCHESTRATEUR AGENT_SALES AGENT_SOUSCRIPTION AGENT_SINISTRES)

gen_hex_keypair() {
  # Prints "priv64hex pub64hex". Nostr pubkey (schnorr) ≠ sha256(priv) in
  # real cryptography; for the local demo (bridge in mode
  # BRIDGE_REQUIRE_SIGNED_COMMANDS=false) the *declarative* value of the npub
  # suffices: we therefore generate priv=rand(32o), pub=sha256(priv) — deterministic and
  # unique per keypair.
  local priv pub
  priv="$(openssl rand -hex 32)"
  pub="$(printf '%s' "$priv" | openssl dgst -sha256 -r | awk '{print $1}')"
  printf '%s %s' "$priv" "$pub"
}

# via buzz-admin: parse "private: <hex>  public: <hex>" (tolerates npub1…/hex64)
gen_via_buzz_admin() {
  local out priv pub
  out="$("${DC[@]}" exec -T buzz buzz-admin generate-key 2>/dev/null | tr -d '\r')" || return 1
  priv="$(printf '%s\n' "$out" | grep -oiE 'priv[a-z]*[^0-9a-f]*([0-9a-f]{64})' | grep -oE '[0-9a-f]{64}' | head -1)"
  pub="$(printf '%s\n' "$out" | grep -oiE 'pub[a-z]*[^0-9a-z]*((npub1[02-9ac-hj-np-z]{58,})|([0-9a-f]{64}))' | grep -oE '(npub1[0-9a-z]{20,}|[0-9a-f]{64})' | head -1)"
  [ -n "$priv" ] && [ -n "$pub" ] || return 1
  printf '%s %s' "$priv" "$pub"
}

if [ "$REUSE" -eq 1 ] && [ -f "$ENV_BUZZ" ]; then
  log_info "--reuse : keeping $ENV_BUZZ"
else
  : >"$ENV_BUZZ.tmp"
  printf '# .env.buzz — generated on %s by scripts/bootstrap-buzz.sh — DO NOT COMMIT\n' "$(now_iso)" >>"$ENV_BUZZ.tmp"
  for role in "${ROLES[@]}"; do
    priv=''; pub=''
    if [ "$HAS_BUZZ_ADMIN" -eq 1 ]; then
      if pair="$(gen_via_buzz_admin)"; then
        priv="${pair%% *}"; pub="${pair#* }"
      else
        log_warn "buzz-admin generate-key: unrecognized format for $role — openssl fallback."
      fi
    fi
    if [ -z "$priv" ]; then
      pair="$(gen_hex_keypair)"
      priv="${pair%% *}"; pub="${pair#* }"
    fi
    printf '%s_NSEC_HEX=%s\n%s_NPUB_HEX=%s\n' "$role" "$priv" "$role" "$pub" >>"$ENV_BUZZ.tmp"
  done
  mv "$ENV_BUZZ.tmp" "$ENV_BUZZ"
  chmod 600 "$ENV_BUZZ" 2>/dev/null || true
  log_ok "Wrote $ENV_BUZZ (chmod 600)."
fi

load_env_file "$ENV_BUZZ"

# ---------- 3. add-member in the relay ----------
if [ "$HAS_BUZZ_ADMIN" -eq 1 ]; then
  log_info "Registering members in the relay…"
  for role in "${ROLES[@]}"; do
    pubvar="${role}_NPUB_HEX"; pub="${!pubvar}"
    # buzz-admin accepts hex64 OR npub1…; we send it raw.
    if "${DC[@]}" exec -T buzz buzz-admin add-member --pubkey "$pub" --role member >/dev/null 2>&1 \
    || "${DC[@]}" exec -T buzz buzz-admin add-member --pubkey "$pub" --role member 2>&1 | grep -qiE 'exist|already|duplicate'; then
      log_ok "add-member $role (${pub:0:12}…)"
    else
      log_warn "add-member $role: non-blocking failure (the bridge can run in unsigned mode without relay membership)."
    fi
  done
else
  log_warn "buzz-admin unavailable: add-member step skipped."
fi

# ---------- 4. Channels ----------
# buzz-admin has NO create-channel (finding: `buzz-admin --help`).
# Chosen path: the bridge creates each channel on its 1st kind:9 emission.
# Here, we force nothing — run-demo-e2e.sh triggers the channels via
# normal business commands, which stays deterministic (names = CHANNEL_NAMES).
CHANNELS=(ceo-command ceo-digest approbations-ceo sales-acquisition \
  souscription-risque sinistres-contentieux support-client finance-pnl \
  marketing-veille conformite-rgpd securite-incidents simulation-events)
log_info "Expected channels (created on 1st kind:9 by the bridge): ${CHANNELS[*]}"

# ---------- 5. npub → role summary ----------
banner "Mapping npub → role (to copy into .env.runtime via init-agents-env.sh)"
for role in "${ROLES[@]}"; do
  pubvar="${role}_NPUB_HEX"; pub="${!pubvar}"
  printf '  %-22s %s\n' "$role" "$pub"
done
log_ok "bootstrap-buzz done. Next step: ./scripts/init-agents-env.sh"
