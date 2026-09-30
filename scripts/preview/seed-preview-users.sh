#!/usr/bin/env bash
# Seed the accounts of a preview slot and close registration.
#
# admin, alex, claude — created with `seedDemoUser` and a generated password
# ONLY WHEN THE ACCOUNT DOES NOT EXIST YET; admin is an admin. An existing
# account is never touched: its password, its data and whatever its owner
# changed there stay as they are (until 2.7.0-beta.17 every run reset all
# three passwords and re-seeded all three accounts, so a tester's own entries
# and the password they had been given vanished on each run). They are
# ordinary accounts, not shared-demo ones (`is_demo = false`); a row an older
# run flagged is corrected. Seeding an admin closes the public
# POST /api/v1/setup/initialize door, which is only guarded by
# `adminCount > 0` (not `userCount > 0`) — without an admin user, any visitor
# could claim the instance via that endpoint.
#
# demo — the REALISTIC demo account (the Rhineland traveller,
# `dist/seedDemoAccount.js`, which is what `npm run seed:demo` runs in the
# image). It is the shared public demo login, and running this script:
#   * RE-SEEDS it: it wipes and re-creates everything the demo account holds,
#     every run — whatever a visitor changed there is gone;
#   * gives it the documented shared demo password (demo123) — it is the
#     shared public demo login, which the server guards as such
#     (`isSharedDemo`);
#   * switches the instance's beta features ON (intended on the preview); the
#     demo session opens with a notice saying so.
# The demo password is read from the seed's own output, so this script does
# not restate it, and a seed that refuses or fails stops the script.
#
# Passwords are written to <PREVIEW_DIR>/<slot>/USERS.txt (0600) and NEVER
# printed: a created account's line is added, an existing account's line is
# kept as it was, the demo line is rewritten. Read them from that file.
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
    NEXT=\"\$USERS.next\"
    : > \"\$NEXT\"

    # Which of the three exist already — and correct the flag on those an
    # older run left marked as the shared demo.
    EXISTING=\$(docker exec preview-${slot} node -e \"
      const { prisma } = require(\\\"/app/backend/dist/db.js\\\");
      const names = process.argv.slice(1);
      prisma.user.updateMany({ where: { username: { in: names } }, data: { isDemo: false } })
        .then(() => prisma.user.findMany({ where: { username: { in: names } }, select: { username: true } }))
        .then(rows => { for (const r of rows) console.log(r.username); process.exit(0); })
        .catch(e => { console.error(e); process.exit(1); });
    \" admin alex claude)

    for u in admin alex claude; do
      if echo \"\$EXISTING\" | grep -qx \"\$u\"; then
        echo \"kept    \$u (existing account: password and data unchanged)\"
        if [ -f \"\$USERS\" ]; then grep \"^\$u \" \"\$USERS\" >> \"\$NEXT\" || true; fi
        continue
      fi
      PW=\$(openssl rand -base64 12 | tr -d /=+ | cut -c1-14)
      if [ \"\$u\" = \"admin\" ]; then IS_ADMIN=true; else IS_ADMIN=false; fi
      # The seed prints the password it set; keep its output off the screen.
      if ! SEED_LOG=\$(docker exec preview-${slot} node -e \"
        const { seedDemoUser } = require(\\\"/app/backend/dist/seedDemoUser.js\\\");
        seedDemoUser({ username: process.argv[1], password: process.argv[2],
                       isAdmin: process.argv[3] === \\\"true\\\", isDemo: false })
          .then(() => process.exit(0))
          .catch(e => { console.error(e); process.exit(1); });
      \" \"\$u\" \"\$PW\" \"\$IS_ADMIN\" 2>&1); then
        echo \"\$SEED_LOG\" | grep -v -i \"password\" >&2
        echo \"SEED FAILED for \$u (see above)\" >&2
        exit 1
      fi
      echo \"\$u \$PW\" >> \"\$NEXT\"
      echo \"created \$u\"
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
    echo \"demo \$DEMO_PW\" >> \"\$NEXT\"
    chmod 600 \"\$NEXT\"
    mv \"\$NEXT\" \"\$USERS\"

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
       && [ \"\$BETA_ON\" = \"t\" ] && echo \"\$DEMO_ROWS\" | grep -qx \"demo|t\" \
       && ! echo \"\$DEMO_ROWS\" | grep -Eqx \"(admin|alex|claude)[|]t\"; then
      echo \"SEED VERIFIED: adminCount>=1, registration closed, only demo flagged as the demo, beta on\"
    else
      echo \"SEED VERIFICATION FAILED: adminCount=\$ADMIN_COUNT allow_registration=\$REG_OPEN beta_features_enabled=\$BETA_ON\" >&2
      exit 1
    fi

    echo \"Passwords: \$USERS (0600) -- not printed here.\"
  '"

ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}" "$remote"
