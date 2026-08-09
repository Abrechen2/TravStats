#!/bin/bash
# Clone the Prod database into the RC Server (staging mirror), so a release
# candidate can be validated against real prod data before it ships.
#
#   Prod (CT100, travstats-db)  --pg_dump-->  RC Server (CT107, travstats-db-rc)
#
# See docs/RELEASE_WORKFLOW.md, stage [3]. Run this BEFORE deploying an RC image
# to the RC Server, so "the RC Server is always a copy of prod (data)" holds.
#
# Postgres auth inside each container is trust over the local unix socket, so no
# password is needed. This is DESTRUCTIVE on the RC-Server DB: it drops and
# recreates every object from the prod dump. Prod is only ever READ.
#
# The defaults target the RC Server (CT107). They used to target CT106 — the
# BETA server, which carries app-tester data that no prod clone may ever
# overwrite — from back when the beta box doubled as the RC target. The rename
# happened on 2026-07-04; these defaults did not follow, so every correct run
# depended on the caller remembering three env overrides. Now the defaults are
# right AND a wrong target is refused outright (see the guard below).
#
# Override any value via env, e.g. CT_RC=110 ./scripts/stage-rc-from-prod.sh
# Non-interactive: FORCE=1 ./scripts/stage-rc-from-prod.sh
set -euo pipefail

PVE_NODE="${PVE_NODE:-192.168.178.180}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
CT_PROD="${CT_PROD:-100}"
CT_RC="${CT_RC:-107}"
DB_PROD_CONTAINER="${DB_PROD_CONTAINER:-travstats-db}"
DB_RC_CONTAINER="${DB_RC_CONTAINER:-travstats-db-rc}"
DB_NAME="${DB_NAME:-flights}"
DB_USER="${DB_USER:-flights}"
DUMP="/tmp/travstats-prod-stage.dump"

# Containers this script must never write to, whatever the caller passes.
# CT_BETA holds the app testers' own data; CT_PROD is the source and read-only.
CT_BETA="${CT_BETA:-106}"

ssh_node() { ssh -i "$SSH_KEY" -o ConnectTimeout=10 -o StrictHostKeyChecking=no "root@$PVE_NODE" "$@"; }

# --- Target guard: refuse before anything is dumped, moved or dropped --------
# A wrong default was the original bug; a wrong ARGUMENT is just as destructive,
# and nothing downstream would notice. Both are refused here, at the top, where
# no state has been touched yet.
if [ "$CT_RC" = "$CT_PROD" ]; then
  echo "REFUSING: the restore target (CT$CT_RC) is PROD. This would destroy production." >&2
  exit 2
fi
if [ "$CT_RC" = "$CT_BETA" ]; then
  echo "REFUSING: the restore target (CT$CT_RC) is the BETA server." >&2
  echo "  Beta carries the app testers' own data and is never a prod mirror." >&2
  echo "  The RC Server is CT107 — run without CT_RC, or pass the right one." >&2
  exit 2
fi
case "$DB_RC_CONTAINER" in
  *-beta|*beta*)
    echo "REFUSING: DB_RC_CONTAINER='$DB_RC_CONTAINER' names a beta database." >&2
    echo "  Expected the RC Server's DB (travstats-db-rc)." >&2
    exit 2
    ;;
esac
if [ "$DB_RC_CONTAINER" = "$DB_PROD_CONTAINER" ]; then
  echo "REFUSING: source and target database container are the same ($DB_RC_CONTAINER)." >&2
  exit 2
fi

# Auto-detect the RC-Server app container (the non-DB travstats container) so we
# can stop it during restore and let its entrypoint re-migrate on restart.
echo "==> Detecting RC-Server app container on CT$CT_RC ..."
APP_RC_CONTAINER="${APP_RC_CONTAINER:-$(ssh_node "pct exec $CT_RC -- sh -c 'docker ps --format \"{{.Names}}\" | grep -i travstats | grep -vi db | head -1'" | tr -d '\r')}"
if [ -z "$APP_RC_CONTAINER" ]; then
  echo "ERROR: could not find the RC-Server app container. Set APP_RC_CONTAINER=<name> and retry." >&2
  exit 1
fi
echo "    app container: $APP_RC_CONTAINER"

echo
echo "This OVERWRITES the RC-Server DB ($DB_RC_CONTAINER on CT$CT_RC)"
echo "with a copy of Prod ($DB_PROD_CONTAINER on CT$CT_PROD). Prod is only read."
if [ "${FORCE:-0}" != "1" ]; then
  read -r -p "Continue? [y/N] " ans
  [ "$ans" = "y" ] || { echo "Aborted."; exit 1; }
fi

echo "==> [1/6] Dump Prod DB inside CT$CT_PROD (custom format)"
ssh_node "pct exec $CT_PROD -- sh -c 'docker exec $DB_PROD_CONTAINER pg_dump -U $DB_USER -Fc $DB_NAME > $DUMP'"

echo "==> [2/6] Move dump CT$CT_PROD -> pve node -> CT$CT_RC"
ssh_node "pct pull $CT_PROD $DUMP $DUMP && pct push $CT_RC $DUMP $DUMP"

echo "==> [3/6] Stop RC-Server app ($APP_RC_CONTAINER) to release DB connections"
ssh_node "pct exec $CT_RC -- sh -c 'docker stop $APP_RC_CONTAINER'"

echo "==> [4/6] Recreate RC-Server DB + restore (PostGIS-safe: restore into an EMPTY DB)"
# --clean/--if-exists into an existing PostGIS DB fights the extension-managed
# objects (spatial_ref_sys etc.). Dropping and recreating the DB and restoring
# into it empty lets the dump recreate the extension + data cleanly.
ssh_node "pct exec $CT_RC -- docker cp $DUMP $DB_RC_CONTAINER:$DUMP"
ssh_node "pct exec $CT_RC -- docker exec $DB_RC_CONTAINER psql -U $DB_USER -d postgres -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME' AND pid<>pg_backend_pid();\""
ssh_node "pct exec $CT_RC -- docker exec $DB_RC_CONTAINER psql -U $DB_USER -d postgres -c \"DROP DATABASE IF EXISTS $DB_NAME;\""
ssh_node "pct exec $CT_RC -- docker exec $DB_RC_CONTAINER psql -U $DB_USER -d postgres -c \"CREATE DATABASE $DB_NAME OWNER $DB_USER;\""
ssh_node "pct exec $CT_RC -- docker exec $DB_RC_CONTAINER pg_restore -U $DB_USER -d $DB_NAME --no-owner $DUMP"

# Re-apply RC-specific settings the prod clone wiped. The prod dump carries
# prod's admin_settings, so the mobile-app pairing URL (public_url) now points
# at prod, not the RC — the app's QR would encode an address it can't reach.
# Set RC_PUBLIC_URL to the RC's own public address (e.g. https://trav.abrechen2.de).
#
# Guarded with an IF EXISTS: older release lines (e.g. 2.2.x) predate the
# public_url column, and a bare UPDATE would error out and abort the whole
# staging run mid-way. Wrapping it in a DO block makes staging schema-agnostic.
if [ -n "${RC_PUBLIC_URL:-}" ]; then
  echo "==> Re-set RC public_url = $RC_PUBLIC_URL (if the column exists)"
  ssh_node "pct exec $CT_RC -- docker exec $DB_RC_CONTAINER psql -U $DB_USER -d $DB_NAME -c \"DO \\\$\\\$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_settings' AND column_name='public_url') THEN UPDATE admin_settings SET public_url='$RC_PUBLIC_URL'; ELSE RAISE NOTICE 'public_url column absent (pre-pairing schema) — skipped'; END IF; END \\\$\\\$;\""
fi

echo "==> [5/6] Restart RC-Server app (entrypoint runs prisma migrate deploy)"
ssh_node "pct exec $CT_RC -- sh -c 'docker start $APP_RC_CONTAINER'"

echo "==> [6/6] Cleanup dump files"
ssh_node "pct exec $CT_PROD -- sh -c 'rm -f $DUMP' ; pct exec $CT_RC -- sh -c 'docker exec $DB_RC_CONTAINER rm -f $DUMP; rm -f $DUMP' ; rm -f $DUMP" || true

echo
echo "Done. The RC Server now holds a copy of Prod data (migrated up by the app entrypoint)."
# Derived, not hardcoded: this line used to print CT106's address, so it sent you
# to the BETA server to verify a restore that had happened on the RC Server.
if [ -n "${RC_PUBLIC_URL:-}" ]; then
  echo "Next: verify ${RC_PUBLIC_URL%/}/health on CT$CT_RC, then run UAT."
else
  echo "Next: verify /health on CT$CT_RC (address in CLAUDE.local.md), then run UAT."
fi
