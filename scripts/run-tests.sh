#!/bin/bash
# Führt alle Tests aus: Backend (benötigt DB), Frontend, E2E (optional).
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_E2E="${SKIP_E2E:-false}"

echo "=== Frontend Tests (Vitest) ==="
cd "$REPO_ROOT/frontend" && npx vitest --run

echo ""
echo "=== Backend Tests (Jest + DB) ==="
echo "HINWEIS: Benötigt laufende PostgreSQL-Instanz."
cd "$REPO_ROOT/backend" && npm test -- --forceExit

if [ "$SKIP_E2E" != "true" ]; then
  echo ""
  echo "=== E2E Tests (Playwright) ==="
  echo "HINWEIS: Benötigt laufenden Dev-Server (npm run dev)."
  cd "$REPO_ROOT" && npx playwright test
fi
echo ""
echo "=== Alle Tests abgeschlossen ==="
