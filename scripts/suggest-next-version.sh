#!/bin/bash
# Suggest next version for TravStats based on git history (Conventional Commits).
# Run from repo root. Reads backend/VERSION; outputs suggested patch/minor/major.
# Usage: ./scripts/suggest-next-version.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION_FILE="$REPO_ROOT/backend/VERSION"

if [ ! -f "$VERSION_FILE" ]; then
  echo "Aktuell: (VERSION-Datei nicht gefunden)"
  echo "Vorschlaege: Bitte backend/VERSION anlegen (z.B. 1.0.0)"
  exit 0
fi

CURRENT="$(cat "$VERSION_FILE" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
# Strip suffix (e.g. -beta, -rc.1)
BASE="${CURRENT%%-*}"
SUFFIX=""
[[ "$CURRENT" == *-* ]] && SUFFIX="-${CURRENT#*-}"

# Parse major.minor.patch
MAJOR=0
MINOR=0
PATCH=0
if [[ "$BASE" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  MAJOR="${BASH_REMATCH[1]}"
  MINOR="${BASH_REMATCH[2]}"
  PATCH="${BASH_REMATCH[3]}"
fi

# Default bump: patch
BUMP="patch"
if [ -d "$REPO_ROOT/.git" ]; then
  COMMITS="$(git log --oneline -50 2>/dev/null || true)"
  if [ -n "$COMMITS" ]; then
    if echo "$COMMITS" | grep -qiE '^(BREAKING CHANGE|.*!.*:|\bbreaking\b)'; then
      BUMP="major"
    elif echo "$COMMITS" | grep -qiE '^[a-f0-9]+ (feat!?|feature)(\([^)]*\))?!?:\s'; then
      BUMP="minor"
    elif echo "$COMMITS" | grep -qiE '^[a-f0-9]+ (feat|feature)(\([^)]*\))?:\s'; then
      BUMP="minor"
    fi
  fi
fi

# Compute next versions
PATCH_NEXT="$MAJOR.$MINOR.$((PATCH + 1))$SUFFIX"
MINOR_NEXT="$MAJOR.$((MINOR + 1)).0$SUFFIX"
MAJOR_NEXT="$((MAJOR + 1)).0.0"

echo "Aktuell: $CURRENT"
echo "Vorschlaege (passend zu Aenderungen):"
echo "  Patch: $PATCH_NEXT"
echo "  Minor: $MINOR_NEXT"
echo "  Major: $MAJOR_NEXT"
echo ""
echo "Naechste Version in backend/VERSION eintragen, dann Docker-Build ausfuehren."
