# Release preparation — 15 October 2026

Status: validation in progress. This document does not authorize deployment or
claim that an RC has been published.

## Source and scope

Work continues on `integrate/ct142-20261015`, from `bb50ac97c`.
The integration includes venue detection, TravPlan, ferry client-reference
protection, map/provider work and the other reconciled development branches.
This pass adds atomic version preconditions for ferry edits/deletes, exposes
supported travel domains separately from enabled domains, and resolves integration
failures in UI tests, type imports and theme/locale use.

## Verified so far

- Fresh isolated PostgreSQL/PostGIS database: migration replay, catalog seed and
  schema drift check passed. No existing instance database was replaced.
- Ferry CRUD/version conflicts, client-reference replay, settings capabilities
  and generated OpenAPI: 4 suites, 41 tests passed.
- Backend and frontend production type checks passed.
- Separate backend test type check: 1,220 test files, no test type errors;
  production/infrastructure diagnostics also cleared.
- Backend and frontend lint passed.
- Backend and frontend production builds passed; peak RSS about 2.7 GiB each.
- Initial full frontend run: 1,134 suites passed, 8 failed (8,804 tests passed,
  26 failed). The failures were missing plan API / map-hook test mocks. After
  correction, 15 affected suites / 88 tests passed, including extracted map
  overlays. Final frontend type check and lint passed.
- Full backend suite is running against the isolated test database.

## Remaining gates

- Complete frontend and backend test runs and coverage comparison.
- Production frontend/backend builds, container build and isolated image boot.
- Source commit/push, unused RC tag selection and immutable image digest record.
- RC deployment approval, followed by live RC acceptance. Deployment has not
  happened in this preparation pass.

The earlier acceptance scenarios in `release-readiness-2026-10-12.md` remain
relevant. Explicitly deferred product decisions are not silently reimplemented
as part of this release preparation. New tile downloads in Companion remain
paused until native provider limits are enforced and verified.

## Resource bounds

Heavy checks run sequentially. Jest uses one worker and worker recycling.
The standalone backend test type check requires about 3.8 GiB RSS; it is run
with a 6 GiB heap cap and stopped if host available memory falls below 10 GiB.
Other test processes have a 4 GiB group RSS limit and a 5 GiB host reserve.
An earlier parallel run exhausted resources; those incomplete logs are not
accepted as successful validation.
