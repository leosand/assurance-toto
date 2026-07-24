#!/usr/bin/env bash
set -euo pipefail

CONFIG="$HOME/.docker/config.json"
if [ ! -f "$CONFIG" ]; then
  echo "No Docker config found at $CONFIG"
  exit 1
fi

echo "Backing up $CONFIG -> ${CONFIG}.bak"
cp "$CONFIG" "${CONFIG}.bak"

echo "Removing credsStore and credHelpers entries (if any) from $CONFIG"
python3 - <<'PY'
import json, os
p = os.path.expanduser(os.path.join(os.environ['HOME'], '.docker', 'config.json'))
with open(p) as f:
    j = json.load(f)
changed = False
for k in ('credsStore','credHelpers'):
    if k in j:
        j.pop(k, None)
        changed = True
if changed:
    with open(p, 'w') as f:
        json.dump(j, f, indent=2)
    print('Removed keys and wrote', p)
else:
    print('No credsStore/credHelpers keys found in', p)
PY

echo "Please restart Docker Desktop (or run 'wsl --shutdown' then start Docker) and retry your build/pull."
