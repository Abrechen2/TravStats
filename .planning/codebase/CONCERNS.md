# Codebase Concerns

**Analysis Date:** 2026-04-03

---

## Tech Debt

### LLM Training Service Is Largely Dead Code — Still 1726 Lines

**Severity:** HIGH

- Issue: `backend/src/services/trainingService.ts` (1726 lines) implements a full LoRA fine-tuning pipeline (`trainModel`, `processTrainingJob`, `exportToOllama`, `evaluateModel`, `cancelTraining`, `analyzeTrainingData`, etc.). The frontend training endpoints were deleted in v0.9.5-beta (PR cleanup), but the backend service itself remains. Only `getTrainingConfig` is called from live routes (`backend/src/routes/admin.ts` lines 581 and 648). The rest of the service is unreachable from any active route.
- Files: `backend/src/services/trainingService.ts`, `backend/src/services/annotationService.ts` (only imported by `trainingService`), `backend/src/services/modelManager.ts` (partially dead — `archivePreviousModel`/`validateModel` only used by `trainingService`)
- Impact: 1726+ lines of unmaintained code increase cognitive overhead and carry forward dead Prisma model dependencies (`TrainingJob`, `TrainingJobLog`). The `canTrainLLM` User permission field and `trainingTriggerLimiter` in `backend/src/middleware/rateLimit.ts` are also orphaned artifacts.
- Fix approach: Delete `trainingService.ts`, `annotationService.ts`; extract only `getTrainingConfig` into a smaller config module; remove `trainingTriggerLimiter`; consider removing `TrainingJob`/`TrainingJobLog` Prisma models and `canTrainLLM` user field if the permission gate is no longer useful.

---

### File Size Violations — Three Files Far Exceed 800-Line Maximum

**Severity:** HIGH

- Issue: Multiple files exceed the hard project limit of 800 lines and the CLAUDE.md guidance of 200–400 lines ideal.
  - `frontend/src/pages/AdvancedStatsPage.tsx` — **2374 lines**
  - `frontend/src/pages/SettingsPage.tsx` — **2095 lines**
  - `frontend/src/lib/api.ts` — **2079 lines**
  - `backend/src/services/trainingService.ts` — **1726 lines** (see above)
  - `frontend/src/components/SimplifiedFlightFormV2.tsx` — **1374 lines**
  - `backend/src/services/parsers/factory.ts` — **1193 lines**
  - `backend/src/routes/admin.ts` — **1186 lines**
- Files: listed above
- Impact: `AdvancedStatsPage.tsx` alone is nearly 3× the maximum. These files are hard to navigate, test, and modify safely. `api.ts` is a monolith mixing parsers, flights, training, stats, templates, and admin API clients.
- Fix approach: Split `api.ts` by domain (e.g., `api.flights.ts`, `api.stats.ts`, `api.parser.ts`). Extract sub-pages/sections from `AdvancedStatsPage` and `SettingsPage` (pattern established in `AdminPage` refactor). Split `parsers/factory.ts` by parser strategy.

---

### Unimplemented TODO Stubs in Route Estimation Service

**Severity:** MEDIUM

- Issue: `backend/src/services/routeEstimationService.ts` has four `TODO` comments marking unimplemented logic — country name lookup via reverse geocoding (line 69), countries based on waypoints for polar route (line 107), typical overflown countries for southern route (line 143), and a hardcoded route data table placeholder (line 181). All three route estimation methods return empty `overflownCountries: []`.
- Files: `backend/src/services/routeEstimationService.ts` lines 69, 107, 143, 181
- Impact: Overflown-country statistics are always empty for flights where route is estimated rather than looked up from an external API. This silently degrades the countries-visited feature.
- Fix approach: Integrate a reverse-geocoding library (e.g., `@turf/turf` point-in-polygon against country GeoJSON) or a static lookup table. Low effort for the southern/polar routes since waypoints are already computed.

---

### Unimplemented TODO Stubs in Flight Enrichment Service

**Severity:** MEDIUM

- Issue: `backend/src/services/flightEnrichmentService.ts` has two `TODO` comments for `aggregateRoutes` (line 360, "Implement proper median/consensus calculation") and `calculateRouteConsistency` (line 412, "Implement proper route comparison"). The current implementation uses the first element of the array as "most recent" and falls back to `JSON.stringify` equality as a consistency metric.
- Files: `backend/src/services/flightEnrichmentService.ts` lines 360, 412
- Impact: Route consistency results (`high`/`medium`/`low`) are unreliable for routes with minor waypoint variations. The aggregated route shown per flight pair is always the first stored route, not the statistical mode.
- Fix approach: Implement Haversine-distance comparison between waypoint arrays to measure similarity; use frequency ranking instead of `JSON.stringify` equality.

---

### Frontend Pagination Via `while (true)` Loops — Four Locations

**Severity:** MEDIUM

- Issue: Client-side data fetching uses unbounded `while (true)` loops to paginate all flights before building filter options or rendering stats. ESLint `no-constant-condition` suppressions are in place to silence the warning.
- Files:
  - `frontend/src/components/Filters.tsx` line 68
  - `frontend/src/components/Stats.tsx` line 39
  - `frontend/src/pages/AdvancedStatsPage.tsx` line 133
  - `frontend/src/pages/FlightsTablePage.tsx` line 52
- Impact: For users with large flight datasets these loops issue many sequential API calls in the browser. There is no upper bound — if the API ever returns inconsistently or a pagination response has an off-by-one in the `total` field, the loop will run indefinitely.
- Fix approach: Replace with server-side aggregation endpoints or add an explicit maximum-iteration guard (e.g., `if (offset >= MAX_FLIGHTS) break;`). Backend already has `GET /api/v1/stats/summary` which could serve pre-aggregated data instead of fetching all flights client-side.

---

### `minRouteCount` Filter Field Stripped Before API Call — Silent No-Op

**Severity:** MEDIUM

- Issue: `minRouteCount` is a frontend-only filter computed in `Filters.tsx` and passed to `DeckGLMap` but is explicitly destructured and discarded before building `apiFilters` in four page-level components. ESLint `no-unused-vars` suppressions acknowledge this.
- Files:
  - `frontend/src/components/Stats.tsx` line 30
  - `frontend/src/pages/DashboardPage.tsx` lines 190, 308, 321
  - `frontend/src/pages/FlightsTablePage.tsx` line 46
- Impact: The "min times flown" filter control in the UI has no effect on any API call — it only affects in-memory layer rendering in the map. Users may believe statistics are filtered by route frequency when they are not.
- Fix approach: Either implement a backend filter parameter for `minRouteCount` in flights listing, or remove the control from the non-map pages' filter UI to avoid misleading users.

---

### Orphaned Debug Scripts in Backend Root

**Severity:** LOW

- Issue: Four ad-hoc scripts remain in `backend/` root that were used during development:
  - `backend/cancel-job.js` — hardcodes a specific `TrainingJob` UUID and calls `prisma.trainingJob.update` directly.
  - `backend/check_running_jobs.js` — queries `TrainingJob` status.
  - `backend/extract_emails.js` — ad-hoc email extraction utility.
  - `backend/mini-test.ts` — inline parser smoke test.
- Files: as listed above
- Impact: These scripts contain hardcoded database IDs, use `console.log` freely, and reference Prisma models. They are not part of the build and are confusing to new contributors. `cancel-job.js` references a specific UUID that no longer exists.
- Fix approach: Delete all four files. Functionality they provided is now handled by admin routes or test suite.

---

### `trainingTriggerLimiter` Defined But Never Applied

**Severity:** LOW

- Issue: `backend/src/middleware/rateLimit.ts` exports `trainingTriggerLimiter` (line 100) for "training trigger endpoint (expensive LLM operation)". After deletion of training trigger routes in v0.9.5-beta, this limiter is never imported or applied anywhere.
- Files: `backend/src/middleware/rateLimit.ts` line 100
- Impact: Dead export, minor confusion.
- Fix approach: Remove the export from `rateLimit.ts`.

---

## Security Considerations

### `console.warn` in `backupService.ts` for Directory Permission Failures

**Severity:** LOW

- Risk: `backend/src/services/backupService.ts` lines 50–51 use `console.warn` (not `logger.warn`) to report backup directory permission failures. This bypasses Pino structured logging, meaning these warnings will not appear in `error.log` and will not be captured by any log monitoring.
- Files: `backend/src/services/backupService.ts` lines 50–51
- Current mitigation: None — failure message goes to unstructured stdout only.
- Recommendations: Replace with `logger.warn(...)` matching the rest of the service.

### `debugLog` with `console.log` in ErrorBoundary — Visible in Production

**Severity:** LOW

- Risk: `frontend/src/components/ErrorBoundary.tsx` defines a `debugLog` function (line 5) that always calls `console.log` with a `[DEBUG ...]` prefix. This runs unconditionally in production builds — there is no `NODE_ENV` guard.
- Files: `frontend/src/components/ErrorBoundary.tsx` lines 5–17, 59, 76
- Current mitigation: Information logged is error state only (component name, error message), not user data.
- Recommendations: Wrap `console.log` in `if (import.meta.env.DEV)` guard or remove the debug helper entirely since the error info is also passed to `console.error` on line 74.

---

## Performance Bottlenecks

### `AdvancedStatsPage.tsx` Fetches All Flights on Mount

**Severity:** MEDIUM

- Problem: `frontend/src/pages/AdvancedStatsPage.tsx` (2374 lines) loads all user flights via the paginated `while (true)` loop (line 133) every time the page is mounted to compute advanced statistics client-side.
- Files: `frontend/src/pages/AdvancedStatsPage.tsx` lines 130–155
- Cause: No server-side aggregation endpoint exists for the advanced statistics variants (streaks, gap analysis, patterns). The client downloads the entire flight history and computes in the browser.
- Improvement path: Add backend aggregation endpoints for streak/gap/pattern statistics (existing `/api/v1/stats/summary` pattern). Add memoization or a Zustand cache so re-mounting the page does not re-fetch.

### `backend/src/services/backupService.ts` Uses `console.warn` in Hot Path

**Severity:** LOW

- Problem: See security note above. Additionally, the 1100-line `backupService.ts` has no unit tests and handles critical data-integrity operations (full database export, WebDAV sync, backup scheduling). Any regression goes undetected until a real backup fails.
- Files: `backend/src/services/backupService.ts`
- Improvement path: Add unit tests with mocked Prisma and mocked `fs` calls.

---

## Fragile Areas

### Parser Factory — 1193 Lines, No Integration Test for Full Pipeline

**Severity:** HIGH

- Files: `backend/src/services/parsers/factory.ts`
- Why fragile: The factory orchestrates six distinct parse strategies (user templates, regex, community templates, LLM text parsers via Ollama/OpenAI/Claude, vision parsers) with complex fallback logic. Individual parsers have unit tests, but there is no test that exercises the factory's full fallback chain end-to-end with a real email fixture.
- Safe modification: Any change to fallback order or confidence thresholds should be tested manually against `test-samples/` fixtures. The existing `backend/src/__tests__/parsers.text.test.ts` (752 lines) tests the regex parser directly, not the factory.
- Test coverage: Factory fallback logic is not covered.

### `regexParser.ts` — Complex Regex Against Multilingual Emails

**Severity:** MEDIUM

- Files: `backend/src/services/parsers/text/regexParser.ts` (685 lines)
- Why fragile: The parser uses a large set of heuristic regexes for DE/EN flight emails. Recent fixes (commits `8ee8f13`, `724c478`, `2f5f3d7`) show the regexes are still being actively debugged for edge cases (next-day `+N` support, IATA false matches in route strings, label-based date assignment). The `while (true)` patterns in the regex engine increase regex backtracking risk on malformed inputs.
- Safe modification: Any regex change requires running `npx jest parsers.text.test` and checking the `test-samples/` corpus manually.
- Test coverage: `backend/src/__tests__/parsers.text.test.ts` covers happy path; edge-cases for mixed-language emails are incomplete per `docs/superpowers/plans/2026-04-03-parser-de-en-completeness.md`.

### `pendingUpdateService.ts` — 812 Lines, Complex State Machine

**Severity:** MEDIUM

- Files: `backend/src/services/pendingUpdateService.ts` (812 lines)
- Why fragile: Manages the "pending corrections" state machine (create, apply, dismiss, promote). It was the subject of a focused test suite (`backend/src/__tests__/pendingUpdateService.test.ts`) but the logic around `promotedCorrections` state transitions is complex and the test file itself is not trivial.
- Safe modification: Any change to approval/rejection logic should go through the existing test suite plus the E2E `pendingUpdates.spec.ts`.

---

## Scaling Limits

### Training Data on Local Disk — 384 MB Untracked

**Severity:** MEDIUM

- Current capacity: `backend/data/training/` contains 384 MB of model checkpoint output directories and JSONL training files from previous fine-tuning runs.
- Limit: These directories are excluded from `.gitignore` implicitly (not explicitly listed in `backend/.gitignore`). Confirmed not tracked by git. However, they are inside `backend/data/` which is also where runtime logs and backups accumulate in production.
- Scaling path: Add an explicit `data/training/` entry to `backend/.gitignore` to make the exclusion intentional. Add a cleanup script or cron job to prune old checkpoint directories once the training pipeline is deprecated.

### No Server-Side Pagination for Stats Aggregation

**Severity:** MEDIUM

- Current capacity: Stats endpoints (`/api/v1/stats/summary`, `/api/v1/stats/seats`, etc.) compute aggregations on every request. For users with 100+ flights this is acceptable but there is no caching layer or incremental computation.
- Limit: As user flight counts grow (1000+ flights), `statsCalculator.ts` (786 lines) aggregations become expensive. No Redis or query-result caching exists.
- Scaling path: Add HTTP response caching headers (`Cache-Control: private, max-age=300`) on stats endpoints or introduce a lightweight query-result cache keyed by `userId + lastModified` timestamp.

---

## Dependencies at Risk

### `react-globe.gl` — Pins `three.js` to Older Version

**Severity:** LOW

- Risk: `react-globe.gl` brings in its own `three.js` as a peer dependency. This can conflict with deck.gl's `@luma.gl` WebGL layer which has its own `three.js` requirements. Currently working but version alignment is fragile.
- Impact: A `three.js` major version bump in either deck.gl or react-globe.gl could cause WebGL context conflicts, similar to the `MapboxOverlay` issue documented in CLAUDE.md.
- Migration plan: Monitor for deck.gl and react-globe.gl release notes; consider replacing react-globe.gl with a deck.gl `GlobeView` when deck.gl 9.x stabilizes that API.

### `eslint-plugin-react-refresh@0.5` — Requires ESLint 9, Blocked

**Severity:** LOW

- Risk: Dependabot PR #38 was closed because `eslint-plugin-react-refresh@0.5` requires ESLint 9, while the project is on ESLint 8. The frontend is therefore pinned to an older `eslint-plugin-react-refresh` version.
- Impact: Potential missed fast-refresh lint rules. No immediate breakage.
- Migration plan: Migrate frontend ESLint config to flat config (ESLint 9) when time permits. Tracked in project memory.

---

## Missing Critical Features

### No Rate Limiting on Email Parse Endpoint

**Severity:** MEDIUM

- Problem: `POST /api/v1/parse-email` (in `backend/src/routes/emailParse.ts`) triggers potentially expensive LLM operations (Ollama, OpenAI, Claude). The boarding pass parse endpoint has `boardingPassParseLimiter` (10 req/15 min) but the email parse route has no equivalent dedicated limiter — it only inherits the general `authenticate` middleware.
- Blocks: Cost control on LLM API calls. Prevents potential abuse of third-party LLM API keys.

### No Unit Tests for Email Service / SMTP Configuration

**Severity:** MEDIUM

- Problem: `backend/src/services/emailService.ts` (implements SMTP send, reminder emails, notification preferences) has no unit test file. The email notification feature was added in v0.9.1-beta.
- Files: `backend/src/services/emailService.ts`, `backend/src/services/reminderScheduler.ts`
- Risk: SMTP configuration changes or template regressions go undetected until a user reports missing notifications.

### No Unit Tests for Backup and Cloud Sync Services

**Severity:** MEDIUM

- Problem: `backend/src/services/backupService.ts` (1100 lines) and `backend/src/services/cloudSyncService.ts` have no test coverage. These services handle the only disaster-recovery mechanism in the application.
- Files: `backend/src/services/backupService.ts`, `backend/src/services/cloudSyncService.ts`
- Risk: Silent regression in backup creation, encryption, or WebDAV upload would only be discovered when a restore is attempted.

### No Tests for Large Page Components

**Severity:** MEDIUM

- Problem: The three largest frontend files — `AdvancedStatsPage.tsx` (2374 lines), `SettingsPage.tsx` (2095 lines), `DashboardPage.tsx` (1001 lines) — have zero test coverage. The frontend test suite covers utility functions, smaller components, and stores but not page-level rendering or user flows.
- Files: `frontend/src/pages/AdvancedStatsPage.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/DashboardPage.tsx`
- Risk: Regressions in stats display, filter interactions, and settings persistence are only caught by E2E tests or manual testing.

### Roadmap Phases 2–5 Not Yet Implemented

**Severity:** LOW (tracked, not a bug)

- Problem: Per `docs/superpowers/specs/roadmap-phases-2-6.md`, the following planned features are not implemented:
  - Phase 2: BCBP barcode decoder, PDF attachment parsing
  - Phase 3: Actual departure/arrival times, delay tracking, CO₂ per flight
  - Phase 4: LLM training pipeline export (export-only, not fine-tuning execution)
  - Phase 5: Extended statistics (airline loyalty score, cost-per-km, timezone-hopping)
  - Phase 6: ICS calendar import (optional)
- Blocks: CO₂ field (`co2Kg`) referenced in `FunStats` UI display code is always null/empty.

---

## Test Coverage Gaps

### Parser Factory Fallback Chain — Not Tested

- What's not tested: The priority ordering of user templates → regex → community templates → LLM is only tested in isolation per parser. The factory's full `try-next-if-confidence-too-low` chain is not covered.
- Files: `backend/src/services/parsers/factory.ts`
- Risk: A confidence threshold change could silently skip a good template result in favour of an LLM call.
- Priority: HIGH

### Backup / Cloud Sync — Not Tested

- What's not tested: All backup creation, scheduling, encryption, and WebDAV upload paths.
- Files: `backend/src/services/backupService.ts`, `backend/src/services/cloudSyncService.ts`
- Risk: Data loss if a backup regression is introduced.
- Priority: HIGH

### Email Service / Reminder Scheduler — Not Tested

- What's not tested: SMTP transporter creation, send logic, reminder template rendering.
- Files: `backend/src/services/emailService.ts`, `backend/src/services/reminderScheduler.ts`
- Risk: Silent notification failures.
- Priority: MEDIUM

### Page-Level Components — Not Tested

- What's not tested: `AdvancedStatsPage`, `SettingsPage`, `DashboardPage` rendering, filter interactions, data display.
- Files: `frontend/src/pages/AdvancedStatsPage.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/DashboardPage.tsx`
- Risk: Stats display regressions only caught manually or by E2E.
- Priority: MEDIUM

### E2E Suite — Narrow Coverage

- What's not tested: Parser import flow, map visualization modes, settings persistence, admin operations, achievements. Only auth, basic flight CRUD, and pending updates have E2E specs.
- Files: `e2e/auth.spec.ts`, `e2e/flights.spec.ts`, `e2e/pendingUpdates.spec.ts`
- Risk: Parser regressions and map rendering issues not caught in CI.
- Priority: MEDIUM

---

*Concerns audit: 2026-04-03*
