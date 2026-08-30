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

PVE_NODE="${PVE_NODE:?set PVE_NODE to the Proxmox node hosting the prod and RC containers -- the concrete addresses live in CLAUDE.local.md, deliberately not in this public repo}"
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

# --- Keep the RC's OWN credentials across the clone --------------------------
# Forgejo #32. The clone carries the database and NOT `/app/data/secrets/`, so
# prod's `admin_settings` arrives holding prod's CIPHERTEXT while the RC holds a
# different encryption key. Every affected provider then reads as unconfigured,
# and it fails quietly: a failed decrypt is a warn, and the resolver treats an
# undecryptable value as absent on purpose, so the only outward sign is a
# provider that does nothing — indistinguishable from one nobody switched on.
#
# The remedy is NOT to bring prod's keys along. That would put production key
# material on a test box to solve a bookkeeping problem. It is to keep the RC's
# own keys, which were entered on the RC, encrypted with the RC's key, and work.
# Same shape as the public_url block below: a value that belongs to the RC is
# taken out of the way and put back after prod's row has landed on top of it.
#
# Column-agnostic on purpose. The credential columns differ between release
# lines, so they are discovered from the row itself rather than listed here —
# a list would go stale silently and lose exactly the key nobody noticed.
KEY_SQL="/tmp/travstats-rc-keys.sql"
GEN_SQL="/tmp/travstats-rc-keygen.sql"
if [ -z "${KEEP_INHERITED_KEYS:-}" ]; then
  echo "==> [2b/6] Save the RC's own API keys before prod's row lands on them"
  # Sent as base64 over stdin, not quoted through ssh -> pct exec -> docker exec
  # -> psql. Four shell layers each eat a backslash, and this statement is made
  # of dollar-quoting and a regex; the repo's own guidance says to pipe rather
  # than escape, and this is exactly the case it was written for.
  #
  # One guarded statement per column, like the public_url block below: prod's
  # schema may predate a column the RC has, and a single wide UPDATE would fail
  # as a whole rather than skip the one column that is missing.
  #
  # `-o` keeps the output ON the RC. The values are ciphertext, but they are
  # still the RC's credentials and there is no reason for them to travel to
  # whichever machine happens to be running this script.
  base64 -w0 <<'GENSQL' | ssh_node "pct exec $CT_RC -- sh -c 'base64 -d > $GEN_SQL'"
SELECT coalesce(string_agg(
  format('DO $do$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name=''admin_settings'' AND column_name=%L) THEN UPDATE admin_settings SET %I=%L; END IF; END $do$;',
         key, key, value), E'\n'), '')
FROM admin_settings a, LATERAL jsonb_each_text(to_jsonb(a))
WHERE value IS NOT NULL
  AND key ~ '(api_key|client_id|client_secret|_token|_secret)$';
GENSQL
  ssh_node "pct exec $CT_RC -- docker cp $GEN_SQL $DB_RC_CONTAINER:$GEN_SQL"
  ssh_node "pct exec $CT_RC -- docker exec $DB_RC_CONTAINER psql -U $DB_USER -d $DB_NAME -At -o $KEY_SQL -f $GEN_SQL" || true
  ssh_node "pct exec $CT_RC -- docker cp $DB_RC_CONTAINER:$KEY_SQL $KEY_SQL" || true
  SAVED=$(ssh_node "pct exec $CT_RC -- sh -c 'grep -c \"^DO\" $KEY_SQL 2>/dev/null || true'" | tr -d '\r\n ')
  SAVED="${SAVED:-0}"
  echo "    $SAVED credential column(s) held back — re-applied after the restore."
  if [ "$SAVED" = "0" ]; then
    echo "    NOTE: none found. After this run the RC carries prod's unreadable ciphertext, so"
    echo "          every affected provider reads as unconfigured — and that looks exactly like"
    echo "          a provider nobody switched on. Re-enter the keys on the RC, or the candidate"
    echo "          is validated against providers it never actually reaches (Forgejo #32)."
  fi
fi

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
# Set RC_PUBLIC_URL to the RC's own address, however it is reached.
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

# Put the RC's own keys back — AFTER the restart, not before it. The restore
# leaves prod's schema in place and the entrypoint migrates it up; a column the
# RC has and prod did not only exists once that has run. Applying earlier would
# skip exactly the newest credential, which is the one a candidate is most
# likely to be testing.
if [ -z "${KEEP_INHERITED_KEYS:-}" ] && [ "${SAVED:-0}" != "0" ]; then
  echo "==> [5b/6] Wait for the entrypoint migration, then re-apply the RC's own keys"
  for _ in $(seq 1 30); do
    if ssh_node "pct exec $CT_RC -- docker exec $DB_RC_CONTAINER psql -U $DB_USER -d $DB_NAME -Atc \"SELECT 1 FROM information_schema.tables WHERE table_name='_prisma_migrations';\"" \
        | grep -q 1; then
      break
    fi
    sleep 2
  done
  ssh_node "pct exec $CT_RC -- docker cp $KEY_SQL $DB_RC_CONTAINER:$KEY_SQL"
  ssh_node "pct exec $CT_RC -- docker exec $DB_RC_CONTAINER psql -U $DB_USER -d $DB_NAME -f $KEY_SQL"
  echo "    Re-applied. Decrypt warnings after this run mean a key that was ALREADY broken"
  echo "    on the RC before the clone, not one this script lost."
fi

echo "==> [6/6] Cleanup dump files"
ssh_node "pct exec $CT_PROD -- sh -c 'rm -f $DUMP' ; pct exec $CT_RC -- sh -c 'docker exec $DB_RC_CONTAINER rm -f $DUMP $KEY_SQL $GEN_SQL; rm -f $DUMP $KEY_SQL $GEN_SQL' ; rm -f $DUMP" || true

echo
echo "Done. The RC Server now holds a copy of Prod data (migrated up by the app entrypoint)."
# Derived, not hardcoded: this line used to print CT106's address, so it sent you
# to the BETA server to verify a restore that had happened on the RC Server.
if [ -n "${RC_PUBLIC_URL:-}" ]; then
  echo "Next: verify ${RC_PUBLIC_URL%/}/health on CT$CT_RC, then run UAT."
else
  echo "Next: verify /health on CT$CT_RC (address in CLAUDE.local.md), then run UAT."
fi
