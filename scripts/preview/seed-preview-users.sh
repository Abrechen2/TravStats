#!/usr/bin/env bash
# Seed demo/alex/claude (non-admin) plus an admin account on a preview slot,
# and close registration. Seeding an admin closes the public
# POST /api/v1/setup/initialize door, which is only guarded by
# `adminCount > 0` (not `userCount > 0`) — without an admin user, any
# visitor could claim the instance via that endpoint.
# Passwords are generated, written to /opt/preview/<slot>/USERS.txt (0600),
# and printed ONCE so they can be moved into a password manager.
set -euo pipefail

NODE1="${NODE1:-192.168.178.171}"
slot="${1:-}"
case "$slot" in beta|poi) ;; *) echo "usage: $0 <beta|poi>" >&2; exit 2 ;; esac

ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}" \
  "pct exec 134 -- bash -c '
    set -e
    umask 077
    : > /opt/preview/${slot}/USERS.txt
    for u in admin demo alex claude; do
      PW=\$(openssl rand -base64 12 | tr -d /=+ | cut -c1-14)
      if [ \"\$u\" = \"admin\" ]; then IS_ADMIN=true; else IS_ADMIN=false; fi
      docker exec preview-${slot} node -e \"
        const { seedDemoUser } = require(\\\"/app/backend/dist/seedDemoUser.js\\\");
        seedDemoUser({ username: process.argv[1], password: process.argv[2],
                       isAdmin: process.argv[3] === \\\"true\\\", resetCredentials: true })
          .then(() => process.exit(0))
          .catch(e => { console.error(e); process.exit(1); });
      \" \"\$u\" \"\$PW\" \"\$IS_ADMIN\"
      echo \"\$u \$PW\" >> /opt/preview/${slot}/USERS.txt
    done
    chmod 600 /opt/preview/${slot}/USERS.txt
    docker exec preview-${slot}-db psql -U flights -d flights -c \
      \"UPDATE admin_settings SET allow_registration = false;\" >/dev/null

    ADMIN_COUNT=\$(docker exec preview-${slot}-db psql -U flights -d flights -tA -c \
      \"SELECT count(*) FROM users WHERE is_admin;\")
    REG_OPEN=\$(docker exec preview-${slot}-db psql -U flights -d flights -tA -c \
      \"SELECT allow_registration FROM admin_settings;\")
    if [ \"\$ADMIN_COUNT\" -ge 1 ] 2>/dev/null && [ \"\$REG_OPEN\" = \"f\" ]; then
      echo \"SEED VERIFIED: adminCount>=1, registration closed\"
    else
      echo \"SEED VERIFICATION FAILED: adminCount=\$ADMIN_COUNT allow_registration=\$REG_OPEN\" >&2
      exit 1
    fi

    cat /opt/preview/${slot}/USERS.txt
  '"
