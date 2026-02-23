#!/bin/bash
# Smoke test: verify a running TravStats instance is healthy
# Usage: ./scripts/smoke-test.sh [BASE_URL]
# Default: http://localhost:3000

set -e
BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local url="$2"
  local expected="${3:-200}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
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
check "Auth endpoint exists" "$BASE_URL/api/v1/auth/login" 405

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then echo "SMOKE TEST FAILED" >&2; exit 1; fi
echo "SMOKE TEST PASSED"
