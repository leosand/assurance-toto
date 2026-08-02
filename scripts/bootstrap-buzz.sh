#!/usr/bin/env bash
# scripts/bootstrap-buzz.sh — Bootstrap du sous-système Buzz (idempotent).
#
# Fait, dans l'ordre :
#   1. Attend que le relais buzz réponde sur /health (port hôte 3002).
#   2. Génère les keypairs Nostr (CEO + 4 agents MVP) — par défaut avec
#      `buzz-admin generate-key` exec'té dans le conteneur buzz ; repli local
#      sur openssl si buzz-admin n'existe pas dans l'image.
#   3. Écrit/rafraîchit `.env.buzz` (gitignored, chmod 600) à la racine du repo.
#   4. Enregistre chaque npub via `buzz-admin add-member` (idempotent).
#   5. Canaux : buzz-admin n'a PAS de sous-commande create-channel (voir
#      docs/OPERATOR.md §Buzz). Buzz crée donc les canaux à la 1re message
#      kind:9 portée par le bridge — ce script vérifie seulement que le relais
#      les expose, et affiche le câblage vers init-agents-env.sh.
#
# Usage : ./scripts/bootstrap-buzz.sh [--reuse]
#   --reuse : réutilise un .env.buzz existant sans regénérer les clés.

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

banner "bootstrap-buzz — relais $BUZZ_HEALTH_URL"

# ---------- 1. Attendre le relais ----------
log_info "Attente du relais buzz…"
if ! wait_http "$BUZZ_HEALTH_URL" 90 200; then
  die "Le relais buzz ne répond pas. Démarre d'abord : ${COMPOSE_FILE} up -d buzz (avec postgres-buzz, redis, minio-init)."
fi
log_ok "Relais buzz up."

# Vérifie le binaire d'admin dans le conteneur.
HAS_BUZZ_ADMIN=0
if "${DC[@]}" exec -T buzz sh -c 'command -v buzz-admin >/dev/null 2>&1' 2>/dev/null; then
  HAS_BUZZ_ADMIN=1
  log_ok "buzz-admin trouvé dans le conteneur $BUZZ_CONTAINER."
else
  log_warn "buzz-admin absent de l'image — repli sur openssl pour les clés (hex Nostr valides, 64 chars)."
fi

# ---------- 2. Génération / réutilisation des keypairs ----------
ROLES=(CEO AGENT_ORCHESTRATEUR AGENT_SALES AGENT_SOUSCRIPTION AGENT_SINISTRES)

gen_hex_keypair() {
  # Affiche "priv64hex pub64hex". pubkey Nostr (schnorr) ≠ sha256(priv) en
  # cryptographie réelle ; pour la démo locale (bridge en mode
  # BRIDGE_REQUIRE_SIGNED_COMMANDS=false) la valeur *déclarative* de l'npub
  # suffit : on génère donc priv=rand(32o), pub=sha256(priv) — déterministe et
  # unique par keypair.
  local priv pub
  priv="$(openssl rand -hex 32)"
  pub="$(printf '%s' "$priv" | openssl dgst -sha256 -r | awk '{print $1}')"
  printf '%s %s' "$priv" "$pub"
}

# via buzz-admin : parse "private: <hex>  public: <hex>" (tolère npub1…/hex64)
gen_via_buzz_admin() {
  local out priv pub
  out="$("${DC[@]}" exec -T buzz buzz-admin generate-key 2>/dev/null | tr -d '\r')" || return 1
  priv="$(printf '%s\n' "$out" | grep -oiE 'priv[a-z]*[^0-9a-f]*([0-9a-f]{64})' | grep -oE '[0-9a-f]{64}' | head -1)"
  pub="$(printf '%s\n' "$out" | grep -oiE 'pub[a-z]*[^0-9a-z]*((npub1[02-9ac-hj-np-z]{58,})|([0-9a-f]{64}))' | grep -oE '(npub1[0-9a-z]{20,}|[0-9a-f]{64})' | head -1)"
  [ -n "$priv" ] && [ -n "$pub" ] || return 1
  printf '%s %s' "$priv" "$pub"
}

if [ "$REUSE" -eq 1 ] && [ -f "$ENV_BUZZ" ]; then
  log_info "--reuse : conservation de $ENV_BUZZ"
else
  : >"$ENV_BUZZ.tmp"
  printf '# .env.buzz — généré le %s par scripts/bootstrap-buzz.sh — NE PAS COMMITTER\n' "$(now_iso)" >>"$ENV_BUZZ.tmp"
  for role in "${ROLES[@]}"; do
    priv=''; pub=''
    if [ "$HAS_BUZZ_ADMIN" -eq 1 ]; then
      if pair="$(gen_via_buzz_admin)"; then
        priv="${pair%% *}"; pub="${pair#* }"
      else
        log_warn "buzz-admin generate-key: format non reconnu pour $role — repli openssl."
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
  log_ok "Écrit $ENV_BUZZ (chmod 600)."
fi

load_env_file "$ENV_BUZZ"

# ---------- 3. add-member dans le relais ----------
if [ "$HAS_BUZZ_ADMIN" -eq 1 ]; then
  log_info "Enregistrement des membres dans le relais…"
  for role in "${ROLES[@]}"; do
    pubvar="${role}_NPUB_HEX"; pub="${!pubvar}"
    # buzz-admin connaît hex64 OU npub1… ; on envoie brut.
    if "${DC[@]}" exec -T buzz buzz-admin add-member --pubkey "$pub" --role member >/dev/null 2>&1 \
    || "${DC[@]}" exec -T buzz buzz-admin add-member --pubkey "$pub" --role member 2>&1 | grep -qiE 'exist|already|duplicate'; then
      log_ok "add-member $role (${pub:0:12}…)"
    else
      log_warn "add-member $role : échec non-bloquant (le bridge peut tourner en mode non-signé sans membership relay)."
    fi
  done
else
  log_warn "buzz-admin indisponible : étape add-member sautée."
fi

# ---------- 4. Canaux ----------
# buzz-admin n'a PAS create-channel (constaté : `buzz-admin --help`).
# Chemin soutenu : le bridge crée chaque canal à sa 1re émission kind:9.
# Ici, on ne force rien — run-demo-e2e.sh déclenche les canaux via les
# commandes métier normales, ce qui reste déterministe (noms = CHANNEL_NAMES).
CHANNELS=(ceo-command ceo-digest approbations-ceo sales-acquisition \
  souscription-risque sinistres-contentieux support-client finance-pnl \
  marketing-veille conformite-rgpd securite-incidents simulation-events)
log_info "Canaux attendus (créés à la 1re kind:9 par le bridge) : ${CHANNELS[*]}"

# ---------- 5. Résumé npub → rôle ----------
banner "Mapping npub → rôle (à coller dans .env.runtime via init-agents-env.sh)"
for role in "${ROLES[@]}"; do
  pubvar="${role}_NPUB_HEX"; pub="${!pubvar}"
  printf '  %-22s %s\n' "$role" "$pub"
done
log_ok "bootstrap-buzz terminé. Prochaine étape : ./scripts/init-agents-env.sh"
