# TravPlan validation — 2026-10-14

The work is isolated on `dev/travplan` in the TravStats and TravStatsCompanion repositories. Server/Web starts at `ff5b05e9f`; Companion starts at `1e615686`. No merge, release promotion or deployment to an existing instance was performed.

## Measured checks

| Check | Result |
| --- | --- |
| Full versioned migration deployment into fresh disposable PostgreSQL databases | Passed, including the additive five-table planning migration |
| Backend planning, real-PostgreSQL transaction, AI policy, weather and existing provider/OpenAPI regression tests | 107 tests in 12 suites passed |
| Web booking adaptation and existing header/menu tests | 54 tests in 7 suites passed |
| Companion outbox, account wipe, relevance card and existing start-screen tests | 33 tests in 5 suites passed |
| Backend production TypeScript build | Passed |
| Backend test type check | 1,194 files checked, zero errors; baseline unchanged |
| Web TypeScript check and production Vite build | Passed |
| Companion TypeScript check and Android Expo export | Passed, 5,083 bundled modules |
| ESLint on the new planning implementation | Passed |
| Handwritten source-size ratchet | Passed; no baseline was raised |
| German/English planning translations | Matching 234-key sets |
| Web/native DTO contract | Equivalent types; formatting differences only |
| Browser layouts | All eight planning sections at 1,440 px and 390 px passed without horizontal page overflow or uncaught JavaScript errors |
| Browser workflows over the LAN HTTP address | Registration, trip creation, itinerary edit, reviewed bookings, exclusion/restoration and Stats/Plan round-trip passed |

Backend tests demonstrate that planned imports and readiness create no countable flights, stays or journal entries. Explicit actual confirmation is idempotent, reserves a revision before materialization, rejects future experience, and reverses only untouched plan-created evidence. Foreign plans, legacy child records and documents remain inaccessible; read tokens cannot mutate a plan. Same-reference multi-leg bookings remain separate, package totals count once, and unknown currencies/totals never become a fabricated free remainder.

AI tests verify no call without consent, no cloud fallback under local-only policy, concurrent request isolation, malformed-output rejection, source-anchor freshness and atomic daily reservations. Weather tests verify provenance, receipt replay, horizon refusal and preservation on provider failure. No live paid model request was used to establish these results.

Companion tests verify persistence before sending, exact replay after a timeout, both conflict versions, deliberate rebasing/discard, late-response rejection after unpairing, separate account/trip keys, and separate bounded Unicode conflict snapshots. Actual confirmation is not queued as experienced while offline.

The web build retains pre-existing large-vendor-chunk warnings. Android export validates the JavaScript/native asset bundle; it does not replace installation and interaction checks on a physical device. Live AI-provider acceptance and a device run remain separate checks. Real routing, verified opening hours, calendar export, collaborative plan editing and proactive push are not represented as implemented controls.
