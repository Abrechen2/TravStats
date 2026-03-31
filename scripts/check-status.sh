#!/bin/bash
# Zeigt: Version, Git-Status, TypeScript-Fehler, Test-Summary.
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=$(cat "$REPO_ROOT/backend/VERSION" | tr -d '\r\n')
echo "=== TravStats Status ==="
echo "Version  : $VERSION"
echo "Branch   : $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
echo "Uncommitted: $(git -C "$REPO_ROOT" status --short | wc -l | tr -d ' ') Datei(en)"
echo ""
echo "--- TypeScript ---"
cd "$REPO_ROOT/backend" && npx tsc --noEmit && echo "Backend  : ✓" || echo "Backend  : ✗ Fehler"
cd "$REPO_ROOT/frontend" && npx tsc --noEmit && echo "Frontend : ✓" || echo "Frontend : ✗ Fehler"
echo ""
echo "--- Lint ---"
cd "$REPO_ROOT/backend" && npm run lint --silent && echo "Backend  : ✓" || echo "Backend  : ✗ Fehler"
cd "$REPO_ROOT/frontend" && npm run lint --silent && echo "Frontend : ✓" || echo "Frontend : ✗ Fehler"
echo ""
echo "--- Frontend Tests ---"
cd "$REPO_ROOT/frontend" && npx vitest --run --reporter=verbose 2>&1 | tail -5
echo ""
echo "==========================="
