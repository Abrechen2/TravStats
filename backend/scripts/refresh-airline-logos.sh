#!/usr/bin/env bash
# Re-vendor the airline logo snapshot from the soaring-symbols npm tarball.
#
# The package is NOT a dependency and must not become one: it declares itself
# CommonJS while shipping ESM `import` syntax in dist/index.cjs, so `require()`
# throws, and its `exports` map blocks reading the data file directly. We only
# want its assets, so we take them and leave the broken wrapper behind — the
# same reason OurAirports and the marnet graph are vendored.
#
# Usage:  npm run refresh:airline-logos          (latest)
#         npm run refresh:airline-logos 0.1.0-alpha.12   (pinned)
set -euo pipefail

VERSION="${1:-latest}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/data/airline-logos"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> fetching soaring-symbols@${VERSION}"
cd "$TMP"
npm pack "soaring-symbols@${VERSION}" >/dev/null
tar -xzf ./*.tgz

PKG="$TMP/package"
RESOLVED="$(node -e "console.log(require('$PKG/package.json').version)")"

if [ ! -d "$PKG/dist/assets" ] || [ ! -f "$PKG/dist/airlines.json" ]; then
  echo "!! upstream layout changed — expected dist/assets and dist/airlines.json" >&2
  exit 1
fi

echo "==> replacing snapshot at $DEST"
rm -rf "$DEST/assets" "$DEST/airlines.json"
mkdir -p "$DEST"
cp -r "$PKG/dist/assets" "$DEST/assets"
cp "$PKG/dist/airlines.json" "$DEST/airlines.json"
cp "$PKG/LICENSE" "$DEST/LICENSE"
printf '%s\n' "$RESOLVED" > "$DEST/VERSION"

COUNT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DEST/airlines.json','utf8')).length)")"
echo "==> vendored soaring-symbols@${RESOLVED} — ${COUNT} airlines"
echo "    Coverage is partial by design; anything missing falls through to the"
echo "    remote tiers. Re-run the vendoredLogos tests: they pin the count."
