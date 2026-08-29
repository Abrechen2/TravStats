#!/usr/bin/env bash
# Create the travstats-preview tunnel, configure ingress, point DNS at it,
# and install cloudflared on CT134. Idempotent.
set -euo pipefail

TOKEN_FILE="${TOKEN_FILE:-$HOME/.cloudflare-travstats-token}"
[[ -f "$TOKEN_FILE" ]] || { echo "missing $TOKEN_FILE" >&2; exit 1; }
TOK=$(cat "$TOKEN_FILE")
ZONE=8e34d30898073f3ee7e95bc0bdcb4022
ACCT=9a4d9c86ff53f151156fc1361af434cf
NODE1="${NODE1:?set NODE1 to the Proxmox node that carries the DMZ bridge -- the concrete addresses live in CLAUDE.local.md, deliberately not in this public repo}"
API=https://api.cloudflare.com/client/v4
NAME=travstats-preview

cf() { curl -s -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" "$@"; }

# Never trust an empty tunnel list — verify the token can see tunnels at all.
probe=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOK" \
  "$API/accounts/$ACCT/cfd_tunnel")
[[ "$probe" == "200" ]] || { echo "token cannot read tunnels (HTTP $probe)" >&2; exit 1; }

id=$(cf "$API/accounts/$ACCT/cfd_tunnel?name=$NAME&is_deleted=false" \
  | python -c "import sys,json;r=json.load(sys.stdin)['result'];print(r[0]['id'] if r else '')")

if [[ -z "$id" ]]; then
  secret=$(openssl rand -base64 32)
  resp=$(cf -X POST "$API/accounts/$ACCT/cfd_tunnel" \
    --data "$(python -c "import json,sys;print(json.dumps({'name':'$NAME','tunnel_secret':'$secret','config_src':'cloudflare'}))")")
  id=$(echo "$resp" | python -c "import sys,json;d=json.load(sys.stdin);
print(d['result']['id']) if d['success'] else sys.exit('create failed: '+json.dumps(d['errors']))")
  echo "created tunnel $NAME ($id)"
else
  echo "tunnel $NAME already exists ($id)"
fi

# Ingress: three hostnames -> localhost ports, plus the mandatory catch-all.
cf -X PUT "$API/accounts/$ACCT/cfd_tunnel/$id/configurations" --data '{
  "config": {
    "ingress": [
      {"hostname": "beta.travstats.de",        "service": "http://localhost:3010"},
      {"hostname": "poi-beta.travstats.de",    "service": "http://localhost:3012"},
      {"service": "http_status:404"}
    ]
  }
}' | python -c "import sys,json;d=json.load(sys.stdin);print('ingress ok' if d['success'] else sys.exit('ingress failed: '+json.dumps(d['errors'])))"

# DNS: proxied CNAMEs at <name>.travstats.de -> <id>.cfargotunnel.com
for h in beta poi-beta; do
  target="$id.cfargotunnel.com"
  rid=$(cf "$API/zones/$ZONE/dns_records?type=CNAME&name=$h.travstats.de" \
    | python -c "import sys,json;r=json.load(sys.stdin)['result'];print(r[0]['id'] if r else '')")
  body=$(python -c "import json;print(json.dumps({'type':'CNAME','name':'$h','content':'$target','proxied':True,'ttl':1}))")
  if [[ -n "$rid" ]]; then
    cf -X PUT "$API/zones/$ZONE/dns_records/$rid" --data "$body" >/dev/null
    echo "updated $h.travstats.de"
  else
    cf -X POST "$API/zones/$ZONE/dns_records" --data "$body" >/dev/null
    echo "created $h.travstats.de"
  fi
done

# Install cloudflared on CT134 using the tunnel's connector token.
ttok=$(cf "$API/accounts/$ACCT/cfd_tunnel/$id/token" \
  | python -c "import sys,json;print(json.load(sys.stdin)['result'])")

ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}" \
  "pct exec 134 -- bash -c '
    set -e
    if ! command -v cloudflared >/dev/null 2>&1; then
      curl -fsSL -o /tmp/cf.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
      dpkg -i /tmp/cf.deb && rm -f /tmp/cf.deb
    fi
    systemctl is-active --quiet cloudflared || cloudflared service install $ttok
    systemctl enable --now cloudflared
    systemctl is-active cloudflared
  '"

echo "tunnel ready: $id"
