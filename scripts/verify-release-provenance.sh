#!/usr/bin/env bash
#
# Verify that a release artifact can be traced back to something that exists.
#
# WHY THIS EXISTS
# ---------------
# On 2026-08-11 two release candidates, 2.5.2-rc.2 and -rc.3, were built and
# deployed to the prod-data mirror from commits that were never pushed to any
# remote, as images that never reached any registry. Both existed only in one
# machine's local Docker cache and one machine's local git. Nothing noticed for
# a day. The same had already happened to 2.6.0-beta.4 through .6.
#
# A build that cannot name a pushed commit and a registry tag is not a release
# candidate — it is a local artifact that happens to be running. This script is
# the check that says so out loud.
#
# It deliberately takes the tag as an ARGUMENT rather than reading it off a
# server: this repository is public, so no host addresses live here. Read the
# running tag from your instance however you normally reach it, then pass it in.
#
# USAGE
#   scripts/verify-release-provenance.sh <tag> [--final]
#
#   <tag>     Image tag as it appears in the registry, e.g. 2.5.2-rc.4 or 2.5.2
#   --final   Also require the Docker Hub mirror and a non-prerelease GitHub
#             release. Implied when <tag> has no -rc./-beta./-security suffix.
#
# EXIT CODES
#   0  every check passed
#   1  at least one check failed — the artifact is not fully traceable
#   2  usage error or a required tool is missing
#
set -uo pipefail

GHCR_REPO="ghcr.io/abrechen2/travstats"
HUB_REPO="docker.io/abrechen2/travstats"

TAG="${1:-}"
if [[ -z "$TAG" || "$TAG" == -* ]]; then
  echo "usage: $0 <tag> [--final]" >&2
  exit 2
fi
shift

FINAL=0
[[ "${1:-}" == "--final" ]] && FINAL=1
# A tag without a pre-release suffix is a final tag whether or not --final was
# passed. Getting this wrong the lenient way would let a final release skip the
# Docker Hub check, which is exactly the mirror users pull from.
[[ "$TAG" =~ -(rc|beta|security)\. ]] || FINAL=1

# `:rc-latest` is the rolling pointer to the newest RELEASE CANDIDATE. A beta
# is a separate track — it lands on the beta server and deliberately does not
# move that tag — so demanding a match there reports a healthy beta as broken.
# Measured on 2.6.0-beta.7, which failed both mirror checks while being
# perfectly traceable.
IS_RC=0
[[ "$TAG" =~ -(rc|security-rc)\. ]] && IS_RC=1

for tool in git gh docker; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 2; }
done

FAILURES=0
pass() { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '  ----  %s\n' "$1"; }

echo "Provenance of ${TAG}$( ((FINAL)) && echo ' (final)')"
echo

# ---------------------------------------------------------------------------
# 1. The image must be in GHCR. This is the check that rc.2/rc.3 would have
#    failed: a local image is not a release artifact.
# ---------------------------------------------------------------------------
GHCR_DIGEST=$(docker buildx imagetools inspect "${GHCR_REPO}:${TAG}" 2>/dev/null \
  | awk 'tolower($1) == "digest:" { print $2; exit }')
if [[ -n "$GHCR_DIGEST" ]]; then
  pass "GHCR has ${TAG} (${GHCR_DIGEST:0:19})"
else
  fail "GHCR has NO ${TAG} — the image exists only where it was built"
fi

# ---------------------------------------------------------------------------
# 2. A git tag must exist and, crucially, must be ON A REMOTE. A local-only tag
#    disappears with the machine that made it.
# ---------------------------------------------------------------------------
GIT_TAG="v${TAG}"
if git rev-parse -q --verify "refs/tags/${GIT_TAG}" >/dev/null; then
  pass "git tag ${GIT_TAG} exists locally"
else
  fail "no local git tag ${GIT_TAG}"
fi

REMOTE_TAG_FOUND=0
for remote in $(git remote); do
  if git ls-remote --tags "$remote" "refs/tags/${GIT_TAG}" 2>/dev/null | grep -q .; then
    pass "git tag ${GIT_TAG} is on '${remote}'"
    REMOTE_TAG_FOUND=1
  else
    fail "git tag ${GIT_TAG} is NOT on '${remote}'"
  fi
done
[[ $REMOTE_TAG_FOUND -eq 0 ]] && info "a tag on no remote is one disk failure from gone"

# ---------------------------------------------------------------------------
# 3. The commit the tag names must be reachable from a pushed branch. A tag can
#    point at a commit that was never pushed, which is how the 11.08. builds
#    were lost.
# ---------------------------------------------------------------------------
if COMMIT=$(git rev-parse -q --verify "refs/tags/${GIT_TAG}^{commit}" 2>/dev/null); then
  if [[ -n "$(git branch -r --contains "$COMMIT" 2>/dev/null)" ]]; then
    pass "commit ${COMMIT:0:8} is contained in a remote-tracking branch"
  else
    fail "commit ${COMMIT:0:8} is on NO remote branch — the source is local only"
  fi
else
  info "skipping commit check: no local tag to resolve"
fi

# ---------------------------------------------------------------------------
# 4. A GitHub release must exist, so the artifact is visible to anyone who is
#    not us. Pre-releases count for an RC; a final needs a real release.
# ---------------------------------------------------------------------------
# `--json` field names differ between gh releases (isLatest does not exist in
# every version, and CT142 still runs gh 2.23.0), so fall back to the plain
# output, which has carried a `prerelease:` line for years. Asking for a field
# the local gh does not know made this report a missing release for one that
# was published minutes earlier.
if REL=$(gh release view "$GIT_TAG" --json isPrerelease 2>/dev/null); then
  IS_PRE=$(printf '%s' "$REL" | grep -o '"isPrerelease":[a-z]*' | cut -d: -f2)
elif REL=$(gh release view "$GIT_TAG" 2>/dev/null); then
  IS_PRE=$(printf '%s' "$REL" | awk -F'\t' '/^prerelease:/ { print $2; exit }')
  [[ -z "$IS_PRE" ]] && IS_PRE=false
fi
if [[ -n "${IS_PRE:-}" ]]; then
  if ((FINAL)); then
    [[ "$IS_PRE" == "false" ]] \
      && pass "GitHub release ${GIT_TAG} is published (not a pre-release)" \
      || fail "GitHub release ${GIT_TAG} is still marked pre-release"
  else
    [[ "$IS_PRE" == "true" ]] \
      && pass "GitHub pre-release ${GIT_TAG} exists" \
      || fail "GitHub release ${GIT_TAG} should be a pre-release for an RC"
  fi
else
  fail "no GitHub release for ${GIT_TAG}"
fi

# ---------------------------------------------------------------------------
# 5. Mirrors. :rc-latest and the Docker Hub finals are what self-hosters
#    actually pull, and they go stale silently — 2.5.1-rc.1 sat on :rc-latest
#    while two newer RCs were live.
# ---------------------------------------------------------------------------
digest_of() { docker buildx imagetools inspect "$1" 2>/dev/null | awk 'tolower($1) == "digest:" { print $2; exit }'; }

if ((FINAL)); then
  for ref in "${HUB_REPO}:${TAG}" "${HUB_REPO}:latest" "${HUB_REPO}:stable" "${GHCR_REPO}:latest" "${GHCR_REPO}:stable"; do
    D=$(digest_of "$ref")
    if [[ -z "$D" ]]; then
      fail "$ref is missing"
    elif [[ -z "$GHCR_DIGEST" ]]; then
      # Without a source digest there is nothing to compare against. Saying
      # "matches" here would be a false OK on exactly the artifact this script
      # exists to catch — one whose image never reached the registry.
      fail "$ref cannot be compared: ${TAG} is not in GHCR"
    elif [[ "$D" != "$GHCR_DIGEST" ]]; then
      fail "$ref points at ${D:0:19}, not at ${TAG}"
    else
      pass "$ref matches ${TAG}"
    fi
  done
elif ((IS_RC == 0)); then
  info "beta build — :rc-latest is the RC pointer and is not expected to move"
else
  for ref in "${GHCR_REPO}:rc-latest" "${HUB_REPO}:rc-latest"; do
    D=$(digest_of "$ref")
    if [[ -z "$D" ]]; then
      fail "$ref is missing"
    elif [[ -z "$GHCR_DIGEST" ]]; then
      # Without a source digest there is nothing to compare against. Saying
      # "matches" here would be a false OK on exactly the artifact this script
      # exists to catch — one whose image never reached the registry.
      fail "$ref cannot be compared: ${TAG} is not in GHCR"
    elif [[ "$D" != "$GHCR_DIGEST" ]]; then
      fail "$ref is STALE — points at ${D:0:19}, not at ${TAG}"
    else
      pass "$ref matches ${TAG}"
    fi
  done
fi

echo
if ((FAILURES)); then
  echo "${FAILURES} check(s) failed — ${TAG} is not fully traceable. Do not promote it."
  exit 1
fi
echo "All checks passed. ${TAG} is reproducible from a pushed commit and a registry image."
