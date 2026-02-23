#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== TravStats Dev Setup ==="

command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker required"; exit 1; }

echo ">>> Installing backend dependencies..."
cd "$REPO_ROOT/backend" && npm ci

echo ">>> Installing frontend dependencies..."
cd "$REPO_ROOT/frontend" && npm ci

echo ">>> Generating Prisma client..."
cd "$REPO_ROOT/backend" && npx prisma generate

if command -v pre-commit >/dev/null 2>&1; then
  cd "$REPO_ROOT" && pre-commit install
  echo "    Pre-commit hooks installed."
else
  echo "    pre-commit not found - run: pip3 install pre-commit && pre-commit install"
fi

echo ""
echo "=== Setup complete! ==="
echo "Next steps:"
echo "  1. Copy .env.example to .env and fill in values"
echo "  2. docker compose up -d db"
echo "  3. cd backend && npx prisma migrate dev"
echo "  4. npm run dev (in backend/ and frontend/ separately)"
