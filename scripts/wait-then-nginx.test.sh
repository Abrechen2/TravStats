#!/usr/bin/env bash
# Test for wait-then-nginx.sh — runs a fake backend on a free port,
# verifies the wrapper polls until /health is up, then "execs" a stub.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WRAPPER="$SCRIPT_DIR/wait-then-nginx.sh"

# Test 1: backend already up → wrapper exits ~immediately and runs the exec target
test_backend_already_ready() {
  echo "TEST 1: backend already ready..."
  local port=18001
  python3 -m http.server "$port" --directory /tmp >/dev/null 2>&1 &
  local server_pid=$!
  trap "kill $server_pid 2>/dev/null || true" EXIT

  # Stub nginx: write a sentinel file then exit
  local sentinel
  sentinel="$(mktemp)"
  rm -f "$sentinel"
  cat > /tmp/fake-nginx.sh <<EOF
#!/bin/sh
echo "fake nginx ran" > "$sentinel"
EOF
  chmod +x /tmp/fake-nginx.sh

  BACKEND_HEALTH_URL="http://localhost:$port/" \
  BACKEND_WAIT_MAX_SECONDS=10 \
  NGINX_BIN=/tmp/fake-nginx.sh \
    "$WRAPPER" >/tmp/wrapper.log 2>&1

  [ -f "$sentinel" ] || { echo "FAIL: stub nginx never ran"; cat /tmp/wrapper.log; return 1; }
  echo "  OK"

  kill "$server_pid" 2>/dev/null || true
  trap - EXIT
}

# Test 2: backend never ready → wrapper times out, still runs exec target with a warning
test_backend_never_ready() {
  echo "TEST 2: backend never ready, falls through after timeout..."
  local sentinel
  sentinel="$(mktemp)"
  rm -f "$sentinel"
  cat > /tmp/fake-nginx.sh <<EOF
#!/bin/sh
echo "fake nginx ran" > "$sentinel"
EOF
  chmod +x /tmp/fake-nginx.sh

  BACKEND_HEALTH_URL="http://localhost:18002/" \
  BACKEND_WAIT_MAX_SECONDS=2 \
  NGINX_BIN=/tmp/fake-nginx.sh \
    "$WRAPPER" >/tmp/wrapper.log 2>&1

  [ -f "$sentinel" ] || { echo "FAIL: stub nginx not run after timeout"; cat /tmp/wrapper.log; return 1; }
  grep -q "WARNING" /tmp/wrapper.log || { echo "FAIL: missing WARNING after timeout"; cat /tmp/wrapper.log; return 1; }
  echo "  OK"
}

test_backend_already_ready
test_backend_never_ready
echo "ALL TESTS PASSED"
