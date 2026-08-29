#!/usr/bin/env bash
# Provision CT134 — public preview host in the DMZ (VLAN 20).
# Idempotent: safe to re-run. Never run against any other CTID.
set -euo pipefail

NODE1="${NODE1:?set NODE1 to the Proxmox node that carries the DMZ bridge -- the concrete addresses live in CLAUDE.local.md, deliberately not in this public repo}"
CTID=134
SSH=(ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}")

if [[ "$CTID" != "134" ]]; then
  echo "refusing: this script only provisions CT134" >&2
  exit 1
fi

if "${SSH[@]}" "pct status $CTID" >/dev/null 2>&1; then
  echo "CT$CTID already exists — skipping create"
else
  "${SSH[@]}" "pct create $CTID local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst \
      --hostname ct134-travstats-preview \
      --cores 4 --memory 8192 --swap 2048 \
      --rootfs ceph-nvme:30 \
      --net0 name=eth0,bridge=vmbr2,ip=${CT_IP:?set CT_IP to the DMZ address for CT134 in CIDR form -- the concrete addresses live in CLAUDE.local.md, deliberately not in this public repo},gw=${CT_GW:?set CT_GW to the DMZ gateway -- the concrete addresses live in CLAUDE.local.md, deliberately not in this public repo} \
      --unprivileged 1 --features nesting=1 \
      --onboot 1 --start 1"
fi

"${SSH[@]}" "pct exec $CTID -- bash -c '
  set -e
  command -v docker >/dev/null 2>&1 || {
    apt-get update -qq
    apt-get install -y -qq curl ca-certificates gnupg
    curl -fsSL https://get.docker.com | sh
  }
  docker network inspect preview-net >/dev/null 2>&1 || docker network create preview-net
  mkdir -p /opt/preview/{ollama,beta,poi}
'"

echo "CT$CTID provisioned."
