#!/usr/bin/env bash
# Seed the accounts of a preview slot and close registration.
#
# admin, alex, claude — `seedDemoUser` with a generated password; admin is an
# admin. Seeding an admin closes the public POST /api/v1/setup/initialize
# door, which is only guarded by `adminCount > 0` (not `userCount > 0`) —
# without an admin user, any visitor could claim the instance via that
# endpoint.
#
# demo — since 2026-09-27 the REALISTIC demo account (the Rhineland traveller,
# `dist/seedDemoAccount.js`, which is what `npm run seed:demo` runs in the
# image), no longer `seedDemoUser`. Until then `demo` got seedDemoUser's
# generic sample data and a random password, so the demo account 2.7.0 ships
# never reached the public preview. That seed behaves differently from the
# other three, and running this script therefore:
#   * RE-SEEDS the demo account: it wipes and re-creates everything the demo
#     account holds, every run — whatever a visitor changed there is gone;
#   * gives it the documented shared demo password (demo123) instead of a
#     random one — it is the shared public demo login, which the server
#     guards as such (`isSharedDemo`);
#   * switches the instance's beta features ON (intended on the preview); the
#     demo session opens with a notice saying so.
# The demo password is read from the seed's own output, so this script does
# not restate it, and a seed that refuses or fails stops the script.
#
# Passwords are written to <PREVIEW_DIR>/<slot>/USERS.txt (0600) and printed
# ONCE so they can be moved into a password manager. The script is idempotent:
# a re-run resets every password and re-seeds every account.
#
# PREVIEW_DIR (default /opt/preview) moves USERS.txt; it exists for
# seed-preview-users.test.sh, which runs the whole script against stubbed
# ssh/pct/docker/openssl and never reaches a host.
set -euo pipefail

NODE1="${NODE1:?set NODE1 to the Proxmox node that carries the DMZ bridge -- the concrete addresses live in CLAUDE.local.md, deliberately not in this public repo}"
slot="${1:-}"
case "$slot" in beta|poi) ;; *) echo "usage: $0 <beta|poi>" >&2; exit 2 ;; esac

PREVIEW_DIR="${PREVIEW_DIR:-/opt/preview}"
# Interpolated into a remote shell command below — plain path characters only.
case "$PREVIEW_DIR" in
  *[!A-Za-z0-9/._-]*) echo "PREVIEW_DIR may only hold letters, digits and / . _ -" >&2; exit 2 ;;
esac

remote="pct exec 134 -- bash -c '
    set -eo pipefail
    umask 077
    USERS=${PREVIEW_DIR}/${slot}/USERS.txt
    : > \"\$USERS\"
    for u in admin alex claude; do
      PW=\$(openssl rand -base64 12 | tr -d /=+ | cut -c1-14)
      if [ \"\$u\" = \"admin\" ]; then IS_ADMIN=true; else IS_ADMIN=false; fi
      docker exec preview-${slot} node -e \"
        const { seedDemoUser } = require(\\\"/app/backend/dist/seedDemoUser.js\\\");
        seedDemoUser({ username: process.argv[1], password: process.argv[2],
                       isAdmin: process.argv[3] === \\\"true\\\", resetCredentials: true })
          .then(() => process.exit(0))
          .catch(e => { console.error(e); process.exit(1); });
      \" \"\$u\" \"\$PW\" \"\$IS_ADMIN\"
      echo \"\$u \$PW\" >> \"\$USERS\"
    done

    # The realistic demo account: wipes and re-creates it, switches beta on.
    if ! SEED_OUT=\$(docker exec -w /app/backend preview-${slot} node dist/seedDemoAccount.js 2>&1); then
      echo \"\$SEED_OUT\" >&2
      echo \"DEMO SEED FAILED (refused or crashed, see above)\" >&2
      exit 1
    fi
    DEMO_PW=\$(echo \"\$SEED_OUT\" | sed -n \"s/^ *Password: *//p\" | head -n 1)
    if [ -z \"\$DEMO_PW\" ]; then
      echo \"\$SEED_OUT\" >&2
      echo \"DEMO SEED FAILED: its output names no password\" >&2
      exit 1
    fi
    echo \"demo \$DEMO_PW\" >> \"\$USERS\"
    chmod 600 \"\$USERS\"

    docker exec preview-${slot}-db psql -U flights -d flights -c \
      \"UPDATE admin_settings SET allow_registration = false;\" >/dev/null

    ADMIN_COUNT=\$(docker exec preview-${slot}-db psql -U flights -d flights -tA -c \
      \"SELECT count(*) FROM users WHERE is_admin;\")
    REG_OPEN=\$(docker exec preview-${slot}-db psql -U flights -d flights -tA -c \
      \"SELECT allow_registration FROM admin_settings;\")
    BETA_ON=\$(docker exec preview-${slot}-db psql -U flights -d flights -tA -c \
      \"SELECT beta_features_enabled FROM admin_settings;\")
    DEMO_ROWS=\$(docker exec preview-${slot}-db psql -U flights -d flights -tA -c \
      \"SELECT username, is_demo FROM users;\")
    if [ \"\$ADMIN_COUNT\" -ge 1 ] 2>/dev/null && [ \"\$REG_OPEN\" = \"f\" ] \
       && [ \"\$BETA_ON\" = \"t\" ] && echo \"\$DEMO_ROWS\" | grep -qx \"demo|t\"; then
      echo \"SEED VERIFIED: adminCount>=1, registration closed, demo account flagged, beta on\"
    else
      echo \"SEED VERIFICATION FAILED: adminCount=\$ADMIN_COUNT allow_registration=\$REG_OPEN beta_features_enabled=\$BETA_ON\" >&2
      exit 1
    fi

    cat \"\$USERS\"
  '"

ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}" "$remote"
