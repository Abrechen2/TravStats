#!/bin/sh
# wait-then-nginx.sh — start nginx ONLY after the backend /health responds.
#
# Why: supervisord starts both nginx and the Express backend in parallel.
# Express needs ~30-90s on first boot (Prisma migrate, airport-closed backfill)
# during which nginx already proxies /api/* to localhost:8000 and gets
# "connection refused" → 502. Browsers cache the empty error state and never
# refetch, leaving the user staring at empty lists despite the DB being intact.
#
# We poll /health here and exec nginx only when the backend is ready. If the
# backend never comes up within BACKEND_WAIT_MAX_SECONDS, we exec nginx anyway
# so that error pages can still be served (better than a blank port).
#
# Configurable via env:
#   BACKEND_HEALTH_URL          (default: http://localhost:8000/health)
#   BACKEND_WAIT_MAX_SECONDS    (default: 300)
#   NGINX_BIN                   (default: /usr/sbin/nginx) — for tests
set -eu

BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://localhost:8000/health}"
MAX_WAIT_SECONDS="${BACKEND_WAIT_MAX_SECONDS:-300}"
NGINX_BIN="${NGINX_BIN:-/usr/sbin/nginx}"
POLL_INTERVAL=2

# Bail fast if wget is missing — silently polling for 5 minutes against a
# missing binary is the worst possible failure mode.
if ! command -v wget >/dev/null 2>&1; then
    echo "[wait-then-nginx] FATAL: wget not found on PATH — starting nginx without health check"
    exec "$NGINX_BIN" -g "daemon off;"
fi

elapsed=0
echo "[wait-then-nginx] Polling ${BACKEND_HEALTH_URL} (max ${MAX_WAIT_SECONDS}s)..."

while [ "$elapsed" -lt "$MAX_WAIT_SECONDS" ]; do
  if wget --no-verbose --tries=1 --spider --timeout=3 "$BACKEND_HEALTH_URL" 2>/dev/null; then
    echo "[wait-then-nginx] Backend ready after ${elapsed}s — starting nginx"
    exec "$NGINX_BIN" -g "daemon off;"
  fi
  sleep "$POLL_INTERVAL"
  elapsed=$((elapsed + POLL_INTERVAL))
done

echo "[wait-then-nginx] WARNING: backend not ready after ${MAX_WAIT_SECONDS}s — starting nginx anyway"
exec "$NGINX_BIN" -g "daemon off;"
