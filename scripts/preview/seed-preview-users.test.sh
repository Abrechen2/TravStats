#!/usr/bin/env bash
# Tests for seed-preview-users.sh. Runs entirely locally: ssh, pct, docker and
# openssl are stubs on PATH, so no host is ever reached. The stub `pct`
# syntax-checks the remote script (`bash -n`) before it runs it, and USERS.txt
# lands in a temporary PREVIEW_DIR.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/seed-preview-users.sh"
pass=0; fail=0
check() { # check <name> <expected> <actual>
  if [[ "$2" == "$3" ]]; then echo "  ok   $1"; pass=$((pass+1))
  else echo "  FAIL $1: expected '$2', got '$3'"; fail=$((fail+1)); fi
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
stubs="$work/bin"
mkdir -p "$stubs"

# ssh: run the last argument (the remote command) locally, as the node would.
cat > "$stubs/ssh" <<'EOF'
#!/usr/bin/env bash
eval "${!#}"
EOF
# pct exec 134 -- bash -c <script>: syntax-check the script, then run it.
cat > "$stubs/pct" <<'EOF'
#!/usr/bin/env bash
[ "$1 $2 $3 $4 $5" = "exec 134 -- bash -c" ] || { echo "pct stub: unexpected '$*'" >&2; exit 97; }
bash -n -c "$6" || { echo "REMOTE SYNTAX ERROR" >&2; exit 98; }
exec bash -c "$6"
EOF
cat > "$stubs/openssl" <<'EOF'
#!/usr/bin/env bash
echo "stubStubStubStubPw"
EOF
# docker: logs one compact line per call, answers the queries the script asks.
cat > "$stubs/docker" <<'EOF'
#!/usr/bin/env bash
all="$*"
case "$all" in
  *seedDemoAccount.js*)
    echo "seedDemoAccount" >> "$STUB_LOG"
    if [ "${STUB_SEED:-ok}" = fail ]; then
      echo "Error: A user named \"demo\" exists ... refusing to reseed."; exit 1
    fi
    echo "🌱 Seeding demo account (demo / demo123) ..."
    [ "${STUB_SEED:-ok}" = nopw ] || echo "   Password: demo123"
    exit 0 ;;
  *updateMany*)
    # which of admin/alex/claude exist (and their flag is corrected)
    echo "existing-query" >> "$STUB_LOG"
    for u in ${STUB_EXISTING:-}; do echo "$u"; done
    exit 0 ;;
  *seedDemoUser*)
    # ... node -e <js> <username> <password> <isAdmin>
    args=("$@")
    reset=no; [[ "$all" == *resetCredentials* ]] && reset=yes
    ordinary=no; [[ "$all" == *"isDemo: false"* ]] && ordinary=yes
    echo "seedDemoUser ${args[$#-3]} reset=$reset ordinary=$ordinary" >> "$STUB_LOG"
    # the real seed prints the password it set
    echo "   Password: ${args[$#-2]}"
    exit 0 ;;
  *"SELECT count(*)"*) echo 1 ;;
  *"SELECT allow_registration"*) echo f ;;
  *"SELECT beta_features_enabled"*) echo "${STUB_BETA:-t}" ;;
  *"SELECT username, is_demo"*)
    if [ "${STUB_FLAGGED:-no}" = yes ]; then printf 'admin|t\nalex|f\nclaude|f\ndemo|t\n'
    else printf 'admin|f\nalex|f\nclaude|f\ndemo|t\n'; fi ;;
  *) : ;;
esac
EOF
chmod +x "$stubs"/*

run() { # every call runs with the stubs first on PATH, so no real ssh is reachable.
  # run <label> [ENV=VALUE...] -> sets out, rc, users, log
  # A USERS.txt already in "$work/<label>/beta" (see `preseed`) is the one a
  # previous run left behind.
  local label="$1"; shift
  local dir="$work/$label"
  mkdir -p "$dir/beta"
  : > "$dir/log"
  out=$(env PATH="$stubs:$PATH" NODE1=stub PREVIEW_DIR="$dir" STUB_LOG="$dir/log" "$@" \
        bash "$SCRIPT" beta 2>&1); rc=$?
  users="$(cat "$dir/beta/USERS.txt" 2>/dev/null)"
  log="$(cat "$dir/log")"
}

# 0. the script itself parses
bash -n "$SCRIPT"; check "script passes bash -n" "0" "$?"

# 1. unknown slot is rejected before anything runs
out=$(PATH="$stubs:$PATH" NODE1=stub bash "$SCRIPT" bogus 2>&1); check "unknown slot rejected" "2" "$?"

# 2. a PREVIEW_DIR that could break out of the remote command is refused
out=$(PATH="$stubs:$PATH" NODE1=stub STUB_LOG=/dev/null PREVIEW_DIR='/tmp/x;id' bash "$SCRIPT" beta 2>&1)
check "unsafe PREVIEW_DIR refused" "2" "$?"

preseed() { # preseed <label> <line>... -> the USERS.txt a previous run left
  local dir="$work/$1"; shift
  mkdir -p "$dir/beta"
  printf '%s\n' "$@" > "$dir/beta/USERS.txt"
}

# 3. a fresh slot: demo gets the realistic seed, the others seedDemoUser
run happy
check "happy path exits 0" "0" "$rc"
check "remote script parsed" "no" "$([[ "$out" == *"REMOTE SYNTAX ERROR"* ]] && echo yes || echo no)"
check "demo runs the realistic seed once" "1" "$(grep -c '^seedDemoAccount$' <<<"$log")"
check "seedDemoUser creates admin, alex, claude as ordinary accounts, resetting nothing" \
  "seedDemoUser admin reset=no ordinary=yes|seedDemoUser alex reset=no ordinary=yes|seedDemoUser claude reset=no ordinary=yes" \
  "$(grep '^seedDemoUser' <<<"$log" | paste -sd'|' -)"
check "USERS.txt names the demo login from the seed's output" "demo demo123" \
  "$(grep '^demo ' <<<"$users")"
check "USERS.txt holds four accounts" "4" "$(grep -c . <<<"$users")"
check "verification passed" "yes" "$([[ "$out" == *"SEED VERIFIED"* ]] && echo yes || echo no)"
check "no generated password reaches stdout" "no" \
  "$([[ "$out" == *stubStubStubSt* ]] && echo yes || echo no)"
check "USERS.txt is not printed" "no" "$([[ "$out" == *"demo demo123"* ]] && echo yes || echo no)"
check "the output says where the passwords are" "yes" \
  "$([[ "$out" == *"USERS.txt (0600)"* ]] && echo yes || echo no)"

# 3b. every account exists: none is reset or re-seeded, their passwords stay
preseed existing "admin keptAdminPw" "alex keptAlexPw" "claude keptClaudePw" "demo oldDemoPw"
run existing STUB_EXISTING="admin alex claude"
check "existing accounts: exits 0" "0" "$rc"
check "existing accounts: no seedDemoUser call" "0" "$(grep -c '^seedDemoUser' <<<"$log")"
check "existing accounts: demo is still re-seeded" "1" "$(grep -c '^seedDemoAccount$' <<<"$log")"
check "existing accounts: their USERS.txt lines are kept" \
  "admin keptAdminPw|alex keptAlexPw|claude keptClaudePw|demo demo123" \
  "$(paste -sd'|' - <<<"$users")"
check "existing accounts: the output names them as kept" "3" "$(grep -c '^kept ' <<<"$out")"

# 3c. only admin exists: alex and claude are created, admin is left alone
preseed partial "admin keptAdminPw"
run partial STUB_EXISTING="admin"
check "partial: seedDemoUser only for the missing ones" \
  "seedDemoUser alex reset=no ordinary=yes|seedDemoUser claude reset=no ordinary=yes" \
  "$(grep '^seedDemoUser' <<<"$log" | paste -sd'|' -)"
check "partial: admin's line kept, the new ones added" "admin keptAdminPw" \
  "$(grep '^admin ' <<<"$users")"
check "partial: four lines" "4" "$(grep -c . <<<"$users")"

# 3d. a named account still flagged as the demo fails the verification
run flagged STUB_FLAGGED=yes
check "a flagged admin fails verification" "yes" \
  "$([[ $rc -ne 0 && "$out" == *"VERIFICATION FAILED"* ]] && echo yes || echo no)"

# 4. a demo seed that refuses stops the script and says why
run refused STUB_SEED=fail
check "refused demo seed exits non-zero" "yes" "$([[ $rc -ne 0 ]] && echo yes || echo no)"
check "refused demo seed is reported" "yes" \
  "$([[ "$out" == *"DEMO SEED FAILED"* && "$out" == *"refusing to reseed"* ]] && echo yes || echo no)"
check "no demo line after a refused seed" "" "$(grep '^demo ' <<<"$users")"

# 5. a seed whose output names no password is not written down as a login
run nopw STUB_SEED=nopw
check "seed without a password exits non-zero" "yes" "$([[ $rc -ne 0 ]] && echo yes || echo no)"
check "seed without a password is reported" "yes" \
  "$([[ "$out" == *"names no password"* ]] && echo yes || echo no)"

# 6. beta still off after the seed fails the verification
run betaoff STUB_BETA=f
check "beta off fails verification" "yes" \
  "$([[ $rc -ne 0 && "$out" == *"VERIFICATION FAILED"* ]] && echo yes || echo no)"

echo "passed=$pass failed=$fail"
[[ $fail -eq 0 ]]
