#!/usr/bin/env bash
# scripts/reset.sh — Full reset (down -v + purge of runtime env files).
# Option: --keep-buzz-keys  keeps .env.buzz / .env.runtime (secrets nvx).
#           -y / --yes        runs without interactive confirmation.

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
    *) die "Unknown option: $arg (expected: --keep-buzz-keys | -y)" ;;
  esac
done

if [ "$ASSUME_YES" -eq 0 ]; then
  printf '⚠️  This will stop the stack %s and DELETE ALL VOLUMES (data).\n' "$COMPOSE_FILE"
  printf "   Continue? [y/N] "
  read -r confirm
  [ "$confirm" = "y" ] || { log_info "Cancelled."; exit 0; }
fi

banner "reset — ${COMPOSE_FILE}"
log_info "docker compose down -v…"
"${DC[@]}" down -v --remove-orphans || true
log_ok "Volumes deleted."

if [ "$KEEP_KEYS" -eq 1 ]; then
  log_info "--keep-buzz-keys → keeping .env.buzz and .env.runtime"
else
  for f in "$ROOT_DIR/.env.buzz" "$ROOT_DIR/.env.runtime"; do
    if [ -f "$f" ]; then rm -f "$f" && log_info "deleted ${f#$ROOT_DIR/}"; fi
  done
fi
log_ok "reset done."
