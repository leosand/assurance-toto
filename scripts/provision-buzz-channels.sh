#!/usr/bin/env bash
# scripts/provision-buzz-channels.sh
# Provision the 12 business channels + a welcome message on the local Buzz relay.
# Uses the Buzz CLI (installed at AppData\Local\Buzz) signed with the CEO key.
# Idempotent: creating an existing channel is harmless (relay dedupes by name? it errors "already exists" — we tolerate).
#
# Usage: ./scripts/provision-buzz-channels.sh
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

# --- Load .env (BUZZ_RELAY_PRIVATE_KEY, BUZZ_RELAY_URL) ---
if [ -f "$ROOT_DIR/.env" ]; then
  set -a; . "$ROOT_DIR/.env"; set +a
fi

BUZZ_BIN="${BUZZ_BIN:-$HOME/AppData/Local/Buzz/buzz.exe}"
RELAY_URL="${BUZZ_RELAY_URL:-http://localhost:3002}"
PRIV="${BUZZ_RELAY_PRIVATE_KEY:-}"
[ -n "$PRIV" ] || die "BUZZ_RELAY_PRIVATE_KEY manquante dans .env"
[ -f "$BUZZ_BIN" ] || die "CLI Buzz introuvable: $BUZZ_BIN"

CHANNELS="ceo-command ceo-digest approbations-ceo sales-acquisition souscription-risque sinistres-contentieux support-client finance-pnl marketing-veille conformite-rgpd securite-incidents simulation-events"

banner "Provisionnement Buzz ($RELAY_URL)"
log_info "CLI: $BUZZ_BIN"

# --- 1. Channels ---
for ch in $CHANNELS; do
  out="$(BUZZ_RELAY_URL="$RELAY_URL" BUZZ_PRIVATE_KEY="$PRIV" "$BUZZ_BIN" channels create --name "$ch" --type stream --visibility open 2>&1)"
  if echo "$out" | grep -q '"accepted":true'; then
    log_ok "channel #$ch créé"
  else
    # "already exists" tolerated — still OK
    log_warn "#$ch: $(echo "$out" | head -c 120)"
  fi
done

# --- 2. Welcome message on #approbations-ceo (need its UUID) ---
log_info "Recherche UUID de #approbations-ceo…"
CH_UUID="$(BUZZ_RELAY_URL="$RELAY_URL" BUZZ_PRIVATE_KEY="$PRIV" "$BUZZ_BIN" channels list 2>/dev/null \
  | tr '}' '}\n' | grep '"name":"approbations-ceo"' | grep -oE '"channel_id":"[0-9a-f-]+"' | head -1 | cut -d'"' -f4)"
if [ -n "$CH_UUID" ]; then
  BUZZ_RELAY_URL="$RELAY_URL" BUZZ_PRIVATE_KEY="$PRIV" "$BUZZ_BIN" messages send \
    --channel "$CH_UUID" \
    --content "Assurance Toto demo workspace — channel #approbations-ceo ready (signed by CEO key)." >/dev/null 2>&1 \
    && log_ok "Message de bienvenue envoyé (#approbations-ceo)"
else
  log_warn "UUID #approbations-ceo introuvable — message de bienvenue sauté"
fi

banner "Provisionnement terminé — ouvrez Buzz Desktop ou le cockpit : http://localhost:3100/dashboard"
