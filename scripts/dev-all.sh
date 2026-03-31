#!/bin/bash
# Startet Backend (Port 8000) und Frontend (Port 3000) parallel.
# Beendet beide bei CTRL+C.
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "TravStats Dev — Backend :8000 | Frontend :3000"
echo "Stoppen mit CTRL+C"
echo ""
(cd "$REPO_ROOT/backend" && npm run dev) &
BACKEND_PID=$!
(cd "$REPO_ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
