#!/bin/bash
# Smoke test: verify a running TravStats instance is healthy
# Usage: ./scripts/smoke-test.sh [BASE_URL]
# Default: http://localhost:3000

BASE_URL="${1:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"  # strip trailing slash
PASS=0
FAIL=0

command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required but not installed"; exit 1; }

check() {
  local desc="$1"
  local url="$2"
  local expected="${3:-200}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  if [ "$status" = "$expected" ]; then
    echo "  PASS  $desc ($status)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $desc (expected $expected, got $status)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== TravStats Smoke Test: $BASE_URL ==="
check "Health endpoint"      "$BASE_URL/health"
check "Frontend loads"       "$BASE_URL/"
check "API 404 on base"      "$BASE_URL/api/v1" 404
check "Auth endpoint exists" "$BASE_URL/api/v1/auth/login" 404

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then echo "SMOKE TEST FAILED" >&2; exit 1; fi
echo "SMOKE TEST PASSED"
