#!/usr/bin/env bash
# Unit tests for deploy-preview.sh argument handling and .env rewriting.
# Runs entirely locally: DRY_RUN=1 stubs every remote call.
set -uo pipefail

SCRIPT="$(dirname "$0")/deploy-preview.sh"
pass=0; fail=0
check() { # check <name> <expected> <actual>
  if [[ "$2" == "$3" ]]; then echo "  ok   $1"; pass=$((pass+1))
  else echo "  FAIL $1: expected '$2', got '$3'"; fail=$((fail+1)); fi
}

# 1. unknown slot is rejected
out=$(DRY_RUN=1 bash "$SCRIPT" bogus 1.2.3 2>&1; echo "rc=$?")
check "unknown slot rejected" "yes" "$([[ "$out" == *"rc=2"* ]] && echo yes || echo no)"

# 2. missing tag is rejected
out=$(DRY_RUN=1 bash "$SCRIPT" beta 2>&1; echo "rc=$?")
check "missing tag rejected" "yes" "$([[ "$out" == *"rc=2"* ]] && echo yes || echo no)"

# 3. each known slot maps to its hostname
for pair in "beta:beta.travstats.de" "poi:poi-beta.travstats.de"; do
  slot="${pair%%:*}"; host="${pair##*:}"
  out=$(DRY_RUN=1 bash "$SCRIPT" "$slot" 9.9.9 2>&1)
  check "slot $slot -> $host" "yes" "$([[ "$out" == *"$host"* ]] && echo yes || echo no)"
done

# 4. refuses to target a production CTID
out=$(DRY_RUN=1 CTID=100 bash "$SCRIPT" beta 9.9.9 2>&1; echo "rc=$?")
check "refuses CTID != 134" "yes" "$([[ "$out" == *"rc=1"* ]] && echo yes || echo no)"

# 5. rejects a tag containing shell metacharacters (command injection attempt)
out=$(DRY_RUN=1 bash "$SCRIPT" beta 'x|e' 2>&1; echo "rc=$?")
check "rejects tag with pipe/shell metachars" "yes" "$([[ "$out" == *"rc=2"* ]] && echo yes || echo no)"

out=$(DRY_RUN=1 bash "$SCRIPT" beta 'a$(id)' 2>&1; echo "rc=$?")
check "rejects tag with command substitution" "yes" "$([[ "$out" == *"rc=2"* ]] && echo yes || echo no)"

echo "passed=$pass failed=$fail"
[[ $fail -eq 0 ]]
