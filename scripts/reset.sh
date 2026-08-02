#!/usr/bin/env bash
# scripts/reset.sh — Reset complet (down -v + purge des fichiers env runtime).
# Option : --keep-buzz-keys  conserve .env.buzz / .env.runtime (nvx secrets).
#          -y / --yes        exécute sans confirmation interactive.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

lib_compose "$ROOT_DIR"

KEEP_KEYS=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --keep-buzz-keys) KEEP_KEYS=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    *) die "Option inconnue: $arg (attendu: --keep-buzz-keys | -y)" ;;
  esac
done

if [ "$ASSUME_YES" -eq 0 ]; then
  printf '⚠️  Ceci arrête la stack %s et SUPPRIME TOUS LES VOLUMES (données).\n' "$COMPOSE_FILE"
  printf "   Continuer ? [y/N] "
  read -r confirm
  [ "$confirm" = "y" ] || { log_info "Annulé."; exit 0; }
fi

banner "reset — ${COMPOSE_FILE}"
log_info "docker compose down -v…"
"${DC[@]}" down -v --remove-orphans || true
log_ok "Volumes supprimés."

if [ "$KEEP_KEYS" -eq 1 ]; then
  log_info "--keep-buzz-keys → conservation de .env.buzz et .env.runtime"
else
  for f in "$ROOT_DIR/.env.buzz" "$ROOT_DIR/.env.runtime"; do
    if [ -f "$f" ]; then rm -f "$f" && log_info "supprimé ${f#$ROOT_DIR/}"; fi
  done
fi
log_ok "reset terminé."
