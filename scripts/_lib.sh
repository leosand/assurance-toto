#!/usr/bin/env bash
# scripts/_lib.sh — Shared helpers (sourced by the other scripts).
# Git Bash / WSL2 : LF only, no sudo, printf instead of echo -e.

# --- Colors (disabled if no TTY) ---
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

# --- Repo root path (sourced from scripts/ or scripts/demo/) ---
repo_root() {
  local dir="$1"
  (cd "$dir" && pwd -P)
}

# --- Compose target for the MVP profile ---
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.lite.yml}"

# Compose command array builder. Usage: lib_compose "$ROOT_DIR"
# Produces the global variable DC=(docker compose -f ... [--env-file .env])
lib_compose() {
  local root="$1"
  if [ -f "$root/.env" ]; then
    DC=(docker compose -f "$root/$COMPOSE_FILE" --env-file "$root/.env")
  else
    DC=(docker compose -f "$root/$COMPOSE_FILE")
  fi
}

# --- Load an env file (KEY=VALUE, tolerates comments) ---
# Usage: load_env_file <file> ; exported in the current environment.
load_env_file() {
  local f="$1"
  [ -f "$f" ] || die "Env file missing: $f"
  set -a
  # shellcheck disable=SC1090
  . "$f"
  set +a
}

# Read a key in an env file without sourcing it (safer).
env_file_get() {
  local f="$1" key="$2"
  [ -f "$f" ] || return 1
  grep -E "^${key}=" "$f" | head -1 | sed -e "s/^${key}=//" -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr -d '\r'
}

require_env() {
  local missing=0
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then
      log_err "Required variable missing: $v"
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 1
}

# --- HTTP wait ---
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
  log_err "Timeout ${timeout}s waiting for ${url} (last code: ${code})"
  return 1
}

# --- psql wrapper on the business postgres container ---
# psql_exec <args...>  — executes `psql` via docker compose exec -T postgres.
# Requires DC (lib_compose called first) + env PG_USER/PG_DB.
psql_exec() {
  "${DC[@]}" exec -T postgres psql -U "$PG_USER" -d "$PG_DB" "$@"
}

# psql_cell <sql> — single value, no headers, raw CSV format.
psql_cell() {
  psql_exec -t -A -c "$1" | tr -d '\r' | head -1
}

# --- HTTP wrapper with separate code + body ---
# http_post <url> <json_body> ; prints "<code> <body>" on stdout.
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

# --- json_extract <json> <field> : jq if present, else python, else node ---
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
    die "Neither jq, python3, nor node available to parse the JSON"
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

# --- ISO-8601 UTC timestamp ---
now_iso() {
  date -u +'%Y-%m-%dT%H:%M:%SZ'
}
