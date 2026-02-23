#!/bin/bash
# Docker-Build mit Versionsvorschlaegen und Build-Arg VERSION.
# Fuehrt suggest-next-version.sh aus, dann docker build mit --build-arg VERSION=...
# Usage: ./scripts/docker-build.sh [docker build args...]
# Example: ./scripts/docker-build.sh -t travstats:dev .

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION_FILE="$REPO_ROOT/backend/VERSION"

cd "$REPO_ROOT"

echo "=== Versionsvorschlaege (passend zu Aenderungen) ==="
"$SCRIPT_DIR/suggest-next-version.sh"
echo ""

VERSION="0.0.0-dev"
[ -f "$VERSION_FILE" ] && VERSION="$(cat "$VERSION_FILE" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

echo "=== Docker Build (VERSION=$VERSION) ==="
docker build --build-arg VERSION="$VERSION" "$@"

echo ""
echo "=== Deploy ==="
echo "VERSION=$VERSION docker compose -f docker-compose.prod.yml up -d"
