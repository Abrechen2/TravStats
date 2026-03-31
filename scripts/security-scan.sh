#!/bin/bash
# Security-Scan: npm audit (frontend + backend) + bandit auf Python-Scripts.
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0

echo "=== Backend npm audit ==="
cd "$REPO_ROOT/backend" && npm audit --audit-level=high || FAILED=1

echo ""
echo "=== Frontend npm audit ==="
cd "$REPO_ROOT/frontend" && npm audit --audit-level=high || FAILED=1

echo ""
echo "=== Bandit (Python scripts) ==="
if command -v bandit &>/dev/null; then
  bandit -r "$REPO_ROOT/backend/src/scripts/" -c "$REPO_ROOT/.bandit.yml" || FAILED=1
else
  echo "bandit nicht installiert — übersprungen (pip install bandit)"
fi

if [ "$FAILED" -eq 1 ]; then
  echo ""
  echo "✗ Security-Scan: Probleme gefunden — bitte prüfen!"
  exit 1
fi
echo ""
echo "✓ Security-Scan abgeschlossen — keine High/Critical gefunden."
