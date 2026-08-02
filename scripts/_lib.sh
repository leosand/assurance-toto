#!/usr/bin/env bash
# scripts/_lib.sh — Helpers partagés (sourcé par les autres scripts).
# Git Bash / WSL2 : LF only, pas de sudo, printf au lieu de echo -e.

# --- Couleurs (désactivées si pas de TTY) ---
if [ -t 1 ]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''; C_RST=''
fi

log_info()  { printf '%s[*]%s %s\n' "$C_BLUE"  "$C_RST" "$*"; }
log_ok()    { printf '%s[+]%s %s\n' "$C_GREEN" "$C_RST" "$*"; }
log_warn()  { printf '%s[!]%s %s\n' "$C_YELLOW" "$C_RST" "$*"; }
log_err()   { printf '%s[x]%s %s\n' "$C_RED"   "$C_RST" "$*" >&2; }

log_pass()  { printf '%s[PASS]%s %s\n' "$C_GREEN" "$C_RST" "$*"; }
log_fail()  { printf '%s[FAIL]%s %s\n' "$C_RED"   "$C_RST" "$*"; }

banner() {
  printf '\n%s==== %s ====%s\n\n' "$C_BOLD" "$*" "$C_RST"
}

die() { log_err "$*"; exit 1; }

# --- Chemin racine du repo (sourcé depuis scripts/ ou scripts/demo/) ---
repo_root() {
  local dir="$1"
  (cd "$dir" && pwd -P)
}

# --- Compose cible du profil MVP ---
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.lite.yml}"

# Compose command array builder. Usage: lib_compose "$ROOT_DIR"
# Produit la variable globale DC=(docker compose -f ... [--env-file .env])
lib_compose() {
  local root="$1"
  if [ -f "$root/.env" ]; then
    DC=(docker compose -f "$root/$COMPOSE_FILE" --env-file "$root/.env")
  else
    DC=(docker compose -f "$root/$COMPOSE_FILE")
  fi
}

# --- Chargement d'un fichier env (KEY=VALUE, tolère commentaires) ---
# Usage: load_env_file <file> ; exporte dans l'environnement courant.
load_env_file() {
  local f="$1"
  [ -f "$f" ] || die "Fichier env manquant: $f"
  set -a
  # shellcheck disable=SC1090
  . "$f"
  set +a
}

# Lecture d'une clé dans un fichier env sans le sourcer (sûr).
env_file_get() {
  local f="$1" key="$2"
  [ -f "$f" ] || return 1
  grep -E "^${key}=" "$f" | head -1 | sed -e "s/^${key}=//" -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr -d '\r'
}

require_env() {
  local missing=0
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then
      log_err "Variable requise absente: $v"
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 1
}

# --- Attente HTTP ---
# wait_http <url> [timeout_s] [expected_status=200]
wait_http() {
  local url="$1" timeout="${2:-60}" expect="${3:-200}" waited=0 code
  while [ "$waited" -lt "$timeout" ]; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || printf '000')"
    if [ "$code" = "$expect" ]; then
      return 0
    fi
    sleep 2; waited=$((waited + 2))
  done
  log_err "Timeout ${timeout}s en attente de ${url} (dernier code: ${code})"
  return 1
}

# --- Wrapper psql côté conteneur postgres métier ---
# psql_exec <args...>  — exécute `psql` via docker compose exec -T postgres.
# Nécessite DC (lib_compose appelé avant) + env PG_USER/PG_DB.
psql_exec() {
  "${DC[@]}" exec -T postgres psql -U "$PG_USER" -d "$PG_DB" "$@"
}

# psql_cell <sql> — une seule valeur, sans en-têtes, format CSV brut.
psql_cell() {
  psql_exec -t -A -c "$1" | tr -d '\r' | head -1
}

# --- Wrapper HTTP avec code + corps séparés ---
# http_post <url> <json_body> ; affiche "<code> <body>" sur stdout.
http_post() {
  local url="$1" body="$2" tmp
  tmp="$(mktemp)"
  local code
  code="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 15 \
    -H 'Content-Type: application/json' -d "$body" "$url" 2>/dev/null || printf '000')"
  printf '%s %s' "$code" "$(cat "$tmp")"
  rm -f "$tmp"
}

http_get() {
  local url="$1" tmp code
  tmp="$(mktemp)"
  code="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 15 "$url" 2>/dev/null || printf '000')"
  printf '%s %s' "$code" "$(cat "$tmp")"
  rm -f "$tmp"
}

# --- json_extract <json> <champ> : jq si présent, sinon python, sinon node ---
json_extract() {
  local json="$1" field="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r "$field" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$json" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
keys = sys.argv[1].lstrip('.').split('.')
cur = data
for k in keys:
    if k == '':
        continue
    if isinstance(cur, list):
        cur = cur[int(k)]
    elif isinstance(cur, dict):
        cur = cur.get(k, '')
    else:
        cur = ''
        break
print(cur if cur is not None else '')
" "$field" 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$json" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
try{
  const field=process.argv[1].replace(/^\./,'').split('.').filter(Boolean);
  let cur=JSON.parse(s);
  for(const k of field){if(cur==undefined){cur='';break;}cur=Array.isArray(cur)&&/^[0-9]+$/.test(k)?cur[Number(k)]:cur[k];}
  console.log(cur==null?'':cur);
}catch(e){}
});" "$field" 2>/dev/null
  else
    die "Ni jq, ni python3, ni node disponible pour parser le JSON"
  fi
}

# --- uuid v4 ---
gen_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-F' 'a-f'
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import uuid; print(uuid.uuid4())'
  else
    node -e "console.log(require('crypto').randomUUID())"
  fi
}

# --- horodatage ISO-8601 UTC ---
now_iso() {
  date -u +'%Y-%m-%dT%H:%M:%SZ'
}
