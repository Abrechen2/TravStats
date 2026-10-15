# Release preparation — 15 October 2026

Status: source validation completed; image build and isolated boot pending.
This document does not authorize deployment or claim that an RC has been published.

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
- Final frontend run: all 1,144 suites and 8,837 tests passed. This includes the
  corrected trip/map fixtures and new request lifecycle, conflict and trip-switch
  cases. Final frontend type check, lint and production build passed.
- Frontend coverage passes all baselines: lines 77.21%, statements 76.04%,
  functions 71.88%, branches 72.28%. Full-run peak RSS was 859 MiB.
- Full backend run against the isolated database completed: 1,214 suites passed,
  3 failed and 3 skipped; 12,026 tests passed, 3 failed and 34 skipped.
  The three failures were the usage-counter federation classification, missing
  propagation for confirmed travel-plan facts and missing map-router response
  classifications. All were corrected. The final regression run passed all
  46 tests in 5 suites, including new sharing/privacy/undo and full-data export
  database cases. The original full-run report and regression report are retained
  separately; this is not described as a second full green run.
- Backend coverage passes every existing baseline: lines 89.50%, statements
  87.81%, functions 90.44%, branches 74.63%. Peak full-run RSS was 2.34 GiB.

## Remaining gates

- Container build and isolated image boot; production frontend/backend builds passed.
- Source commit/push, unused RC tag selection and immutable image digest record.
- RC deployment approval, followed by live RC acceptance. Deployment has not
  happened in this preparation pass.

The earlier acceptance scenarios in `release-readiness-2026-10-12.md` remain
relevant. Explicitly deferred product decisions are not silently reimplemented
as part of this release preparation. New tile downloads in Companion remain
paused until native provider limits are enforced and verified.

## Resource bounds

Heavy checks run sequentially. The final backend run uses two recycled workers,
each with its own fresh temporary database. Frontend uses two workers within
the same 4 GiB group memory guard; Companion uses one.
The standalone backend test type check requires about 3.9 GiB RSS; it is run
with a 6 GiB heap cap and stopped if host available memory falls below 10 GiB.
Other test processes have a 4 GiB group RSS limit and a 5 GiB host reserve.
An earlier parallel run exhausted resources; those incomplete logs are not
accepted as successful validation.
