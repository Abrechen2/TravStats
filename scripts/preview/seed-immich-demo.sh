#!/usr/bin/env bash
# Seed the demo Immich instance: create the admin account, mint an API key,
# upload sample photos, and build two albums so the preview instances have
# real data to demo without anyone handing a real Immich API key to a
# public pre-release instance.
#
# Since 2026-08-01 the consumer is the BETA slot: the dedicated immich slot
# was retired once dev/immich-albums was fully merged, and this demo server
# is now configured as the beta slot's admin-global Immich.
#
# Credentials are written ONLY to /opt/preview/immich-demo/CREDENTIALS.txt
# (mode 0600) on CT134 — never printed, never committed to the repo.
#
# The live instance's OpenAPI spec is served at
# http://immich-demo-server:2283/api/spec.json (note: `.json`, not the
# `-json` suffix some older Immich docs use). Verified against it on
# 2026-07-09: /auth/admin-sign-up, /auth/login and /api-keys match this
# script's assumptions. /assets (upload) no longer requires
# deviceAssetId/deviceId — only fileCreatedAt, fileModifiedAt and
# assetData are required. /albums accepts an initial assetIds array at
# creation time, so no separate add-to-album call is needed.
#
# Runs entirely via `pct exec 134 -- bash -s` + a heredoc so nothing needs
# nested shell-quoting; all Immich calls happen inside the
# immich-demo-server container via `docker exec ... curl` (that image
# ships curl, unlike the TravStats app image).
set -euo pipefail

NODE1="${NODE1:?set NODE1 to the Proxmox node that carries the DMZ bridge -- the concrete addresses live in CLAUDE.local.md, deliberately not in this public repo}"
CTID="${CTID:-134}"

if [[ "$CTID" != "134" ]]; then
  echo "refusing: this seed script only targets CT134 (got $CTID)" >&2
  exit 1
fi

ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}" \
  "pct exec $CTID -- bash -s" <<'REMOTE'
set -euo pipefail

BASE="http://immich-demo-server:2283/api"
CRED_FILE="/opt/preview/immich-demo/CREDENTIALS.txt"
ADMIN_EMAIL="admin@preview.travstats.local"
ADMIN_NAME="TravStats Preview Admin"

dexec() { docker exec immich-demo-server "$@"; }

if [[ -f "$CRED_FILE" ]]; then
  echo "credentials already exist at $CRED_FILE, reusing admin account"
  ADMIN_PASSWORD=$(python3 -c "
for line in open('$CRED_FILE'):
    if line.startswith('IMMICH_ADMIN_PASSWORD='):
        print(line.strip().split('=', 1)[1])
")
  API_KEY=$(python3 -c "
for line in open('$CRED_FILE'):
    if line.startswith('IMMICH_API_KEY='):
        print(line.strip().split('=', 1)[1])
")
else
  ADMIN_PASSWORD=$(openssl rand -hex 16)
  echo "creating admin account"
  signup=$(dexec curl -s -X POST "$BASE/auth/admin-sign-up" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"name\":\"$ADMIN_NAME\"}")
  echo "$signup" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'id' in d, d" \
    || { echo "admin-sign-up failed (instance not virgin?): $signup" >&2; exit 1; }
  echo "admin created"

  echo "logging in"
  login=$(dexec curl -s -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
  ACCESS_TOKEN=$(echo "$login" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
  [[ -n "$ACCESS_TOKEN" ]] || { echo "login failed: $login" >&2; exit 1; }

  echo "creating API key"
  keyresp=$(dexec curl -s -X POST "$BASE/api-keys" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -d '{"name":"travstats-preview-seed","permissions":["all"]}')
  API_KEY=$(echo "$keyresp" | python3 -c "import sys,json; print(json.load(sys.stdin)['secret'])")
  [[ -n "$API_KEY" ]] || { echo "api-key creation failed: $keyresp" >&2; exit 1; }

  umask 077
  mkdir -p /opt/preview/immich-demo
  {
    echo "IMMICH_ADMIN_EMAIL=$ADMIN_EMAIL"
    echo "IMMICH_ADMIN_PASSWORD=$ADMIN_PASSWORD"
    echo "IMMICH_API_KEY=$API_KEY"
    echo "IMMICH_URL=http://immich-demo-server:2283"
  } > "$CRED_FILE"
  chmod 600 "$CRED_FILE"
  echo "credentials written to $CRED_FILE"
fi

echo "fetching sample photos"
for i in 1 2 3; do
  dexec curl -sSL --max-time 20 -o "/tmp/preview-seed-$i.jpg" "https://picsum.photos/1200/800?random=$i"
done

echo "uploading assets"
NOW="2024-01-01T00:00:00.000Z"
ASSET_1=""
ASSET_2=""
ASSET_3=""
for i in 1 2 3; do
  up=$(dexec curl -s -X POST "$BASE/assets" \
    -H "x-api-key: $API_KEY" \
    -F "fileCreatedAt=$NOW" \
    -F "fileModifiedAt=$NOW" \
    -F "filename=preview-seed-$i.jpg" \
    -F "assetData=@/tmp/preview-seed-$i.jpg;type=image/jpeg")
  aid=$(echo "$up" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  [[ -n "$aid" ]] || { echo "asset $i upload failed: $up" >&2; exit 1; }
  eval "ASSET_$i=\$aid"
  echo "asset $i -> $aid"
done

echo "creating albums"
alb1=$(dexec curl -s -X POST "$BASE/albums" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{\"albumName\":\"Demo Trip - Alps\",\"description\":\"Seeded preview album\",\"assetIds\":[\"$ASSET_1\",\"$ASSET_2\"]}")
alb2=$(dexec curl -s -X POST "$BASE/albums" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{\"albumName\":\"Demo Trip - Coastline\",\"description\":\"Seeded preview album\",\"assetIds\":[\"$ASSET_2\",\"$ASSET_3\"]}")

echo "$alb1" | python3 -c "import sys,json; d=json.load(sys.stdin); print('album 1:', d['id'], 'assetCount', d.get('assetCount'))"
echo "$alb2" | python3 -c "import sys,json; d=json.load(sys.stdin); print('album 2:', d['id'], 'assetCount', d.get('assetCount'))"

echo "SEED_COMPLETE"
REMOTE
