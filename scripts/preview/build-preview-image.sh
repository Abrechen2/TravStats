#!/usr/bin/env bash
# Build a mutable :preview-<slot> image from a worktree and push to GHCR.
# The tag means "whatever is on that branch right now" — it is intentionally
# not immutable. Never used for RC or release images.
set -euo pipefail

slot="${1:-}"
case "$slot" in
  poi)    wt=".claude/worktrees/hotels" ;;
  *) echo "usage: $0 <poi>" >&2; exit 2 ;;
esac

[[ -d "$wt" ]] || { echo "worktree missing: $wt" >&2; exit 1; }

tag="preview-$slot"
commit=$(git -C "$wt" rev-parse --short HEAD)
echo "building $tag from $wt @ $commit"

docker build --platform linux/amd64 \
  --build-arg "VERSION=${tag}-${commit}" \
  -t "ghcr.io/abrechen2/travstats:${tag}" \
  "$wt"

docker push "ghcr.io/abrechen2/travstats:${tag}"
echo "pushed ghcr.io/abrechen2/travstats:${tag} ($commit)"
