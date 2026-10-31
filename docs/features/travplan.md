# TravPlan implementation

TravPlan is an optional planning mode on the existing server. The logo opens the mode selector; the selected mode has a blue accent. Both views use the existing application header. A plan belongs to the same owned `Trip` as its actual travel records.

## Available flows

- Create trips, edit destination, dates, pace, party size and budget; keep a day intentionally free.
- Collect ideas, assign them to a day atomically, edit movable activities and retain fixed booking anchors.
- Read emails/PDFs through the existing parser pipeline, then review candidates individually before saving. Flight, lodging, rail, cruise, rental and package readings are adapted. Original documents are retained only when selected.
- Read existing owned records into fixed anchors. Explicit source refresh updates their snapshot; planning never rewrites those records. Source changes invalidate AI help before it is accepted.
- Exclude bookings from the itinerary while preserving their originals and committed costs; restore them when needed.
- Recognize overnight gaps, overlaps across known zones, busy days, arrival buffers, missing or changed transfers, unknown costs and budget overruns. An intentionally open decision stays quiet. The overview shows at most three findings.
- Maintain transfer arrangements, tasks, costs and personal/shared packing entries. Laundry and luggage preferences give clothing guidance. Weather and walking hints are offered for individual adoption.
- Select a weather location using Open-Meteo/GeoNames. Fetch a real bounded forecast on request, with source and retrieval date. Dates beyond the forecast horizon remain unknown; errors preserve existing data.
- Enable optional AI per trip. The default policy allows local providers only. Request ideas or changes, inspect the proposal and assumptions, then accept or reject it. No background generation, automatic booking or cloud fallback is performed. Unknown committed totals keep their remaining payment and remaining budget unknown; known deposits are a cost floor.
- Mark the plan ready and open its existing Trip in TravStats. Readiness does not confirm travel. Explicit experience confirmation creates flight/stay/journal evidence; other transport types link an existing completed owned record. Withdrawal protects records edited or enriched since confirmation.
- Open the same plan in Companion: Today, itinerary, packing and originals. Local edits are persisted before sending. Network retries keep the original receipt; conflicts retain local and server versions until reviewed. Actual confirmation and AI application require a connection.
- Companion offers a quiet home entry for an active trip or its final preparation week. Importing its pre-existing local packing list is voluntary. Unpairing removes plan caches and queued edits, including late responses.

## Architecture decision: stage plans separately

Planned bookings and activities stay in a validated, bounded `TravelPlan.state` JSON document. They are **not** inserted as completed legacy domain records. This avoids changing every existing statistics, passport and achievement query to understand another execution flag. Creation mirrors planned date metadata into the canonical Trip so upcoming-trip views can discover it; it asserts no actual travel. A Trip with existing domain records retains its metadata.

The additive migration introduces five tables: plans, mutation receipts, proposals, instance configuration and daily usage. A plan has an integer revision; a transactional compare-and-set reserves it before creating physical evidence. Client UUIDs plus canonical payload hashes make retries idempotent. Undo restores only the latest accepted mutation and increments the revision; edited actual records are protected rather than deleted.

Read endpoints require ownership, including when the feature is disabled. Writes also require a write-capable token and a non-demo account. Configuration is admin-only. This extension belongs to the existing Trips response family (bare resources), recorded in the response-family ratchet. OpenAPI documents every endpoint and its response schema.

AI uses the existing administrator-managed provider system and its global consent gates. A per-request policy also constrains parser fallbacks through `AsyncLocalStorage`, so concurrent imports cannot borrow another request's cloud permission. Planning prompts contain destination, dates, pacing, free days, timing anchors, budget totals, packing preferences, the user's request and forecast provenance. They exclude booking references, originals and private item notes. Proposals expire after one hour and require unchanged revision, state hash, source anchors and valid changes. AI/weather limits are persistent and atomically reserved.

## Activation

On an existing instance, apply the additive migration through the normal release process. Enable **TravPlan** under `/plan/admin` (also reachable from the logo as an administrator). Existing instances start with planning disabled. `TRAVPLAN_ENABLED=true` (and `TRAVTRACK_ENABLED=true`) is no longer read; a start that still finds it copies it once into the saved configuration if none exists yet.

The branch does not enable or deploy the feature on any existing instance. AI requires an already configured permitted provider; live model credentials are not supplied by this feature.

## Local isolated verification

Use a fresh local PostgreSQL database with PostGIS, `pg_trgm` and the full versioned migrations. The example database must belong to a disposable test server, never to an existing instance:

```sh
export DATABASE_URL=postgresql://postgres@127.0.0.1:15439/travplan_test
cd backend
npx prisma migrate deploy
npx jest --config jest.travplan.config.cjs --runInBand
npm run typecheck:tests
```

The dedicated test setup refuses non-loopback hosts and database names outside `travplan_*`. It does not reset a database or replace its contents. It generates an ephemeral test JWT key without printing it. Tests create their own users and records.

For the complete web application with startup schedulers suppressed:

```sh
# From backend, using the same explicit disposable database:
CORS_ORIGIN=http://localhost:5180 PORT=3540 npx tsx scripts/travplan-preview.ts
# Another terminal, from frontend:
npx vite --config vite.travplan.config.ts
```

This helper enables planning only in that disposable database. A fresh database follows the existing setup flow, where the local owner creates their own account. Native Companion uses its normal pairing process against the development server; do not substitute production credentials.

## Verification and practical limits

See `travplan-validation.md` for measured results. The implementation is a working feature branch, not a release or a migrated existing installation. Live paid-provider behavior and a physical-device run are separate acceptance checks. Real routing/travel-time services, opening-hour verification, collaborative plan editing, calendar export and proactive push notifications are not claimed or exposed as working controls. Flight/stay confirmation uses existing domain writers; other transport records use reviewed links to their existing domain forms.
