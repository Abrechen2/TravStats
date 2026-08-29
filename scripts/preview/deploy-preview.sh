#!/usr/bin/env bash
# Deploy an ALREADY-BUILT GHCR tag to a preview slot on CT134.
# Never builds. Never targets any CT other than 134.
#
#   bash scripts/preview/deploy-preview.sh beta 2.3.0-beta.11
#   bash scripts/preview/deploy-preview.sh poi preview-poi
#
# The immich slot (port 3011) was retired on 2026-08-01: dev/immich-albums is
# fully merged, so the feature ships on the beta slot. The demo Immich server
# stays on preview-net and is now the beta slot's admin-global instance.
set -uo pipefail

NODE1="${NODE1:?set NODE1 to the Proxmox node that carries the DMZ bridge -- the concrete addresses live in CLAUDE.local.md, deliberately not in this public repo}"
CTID="${CTID:-134}"
DRY_RUN="${DRY_RUN:-0}"

if [[ "$CTID" != "134" ]]; then
  echo "refusing: preview deploys only target CT134 (got $CTID)" >&2
  exit 1
fi

slot="${1:-}"; tag="${2:-}"
case "$slot" in
  beta)   host="beta.travstats.de";        port=3010 ;;
  poi)    host="poi-beta.travstats.de";    port=3012 ;;
  *) echo "usage: $0 <beta|poi> <ghcr-tag>" >&2; exit 2 ;;
esac
[[ -n "$tag" ]] || { echo "usage: $0 <beta|poi> <ghcr-tag>" >&2; exit 2; }
if ! [[ "$tag" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "invalid tag: $tag (allowed: A-Za-z0-9._-)" >&2; exit 2
fi

echo "slot=$slot host=$host port=$port tag=$tag"
[[ "$DRY_RUN" == "1" ]] && { echo "dry run, stopping"; exit 0; }

ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}" \
  "pct exec $CTID -- bash -c '
    set -e
    cd /opt/preview/$slot
    sed -i \"s|^IMAGE_TAG=.*|IMAGE_TAG=$tag|\" .env
    docker compose pull -q
    docker compose up -d
  '" || { echo "deploy failed" >&2; exit 3; }

echo -n "health: "
ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}" \
  "pct exec $CTID -- curl -sf --max-time 180 --retry 20 --retry-all-errors --retry-delay 3 http://127.0.0.1:$port/health" \
  || { echo "UNHEALTHY" >&2; exit 4; }
echo

echo -n "public: "
curl -sf -o /dev/null -w "%{http_code}\n" --max-time 15 "https://$host/health" \
  || echo "(tunnel not configured yet — expected before Task 7)"
