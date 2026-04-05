# Enrichment Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Historical Enrichment feature with a two-mode system (Full < 1 year / Slim ≥ 1 year), always-require-approval, fix the infinite re-processing loop, improve route aggregation with median interpolation, and simplify settings from 6 to 3 options.

**Architecture:** The service gains a `getEnrichmentMode()` helper that branches logic by flight age. The DB sheds 3 now-redundant columns. The PendingUpdateCard gets an enrichment badge so users always know what they're confirming.

**Tech Stack:** TypeScript, Express, Prisma (PostgreSQL), React 18, Vitest (frontend), Jest (backend)

---

## File Map

**Modified (backend):**
- `backend/prisma/schema.prisma` — remove 3 UserSettings fields
- `backend/prisma/migrations/<new>/migration.sql` — DROP 3 columns
- `backend/src/services/flightEnrichmentService.ts` — full redesign
- `backend/src/jobs/historicalEnrichmentScheduler.ts` — remove autoProcess gate
- `backend/src/routes/settings/general.ts` — simplify Zod schema + handlers

**Created (backend):**
- `backend/src/services/__tests__/flightEnrichmentService.test.ts`

**Modified (frontend):**
- `frontend/src/components/Settings/EnrichmentSection.tsx` — remove 3 inputs, add mode explanation
- `frontend/src/components/Settings/useSettingsPage.ts` — remove 3 fields
- `frontend/src/components/PendingUpdateCard.tsx` — enrichment badge + Vorschlag hint
- `frontend/src/i18n/resources/de/settings.json` — update historicalEnrichment keys
- `frontend/src/i18n/resources/en/settings.json` — update historicalEnrichment keys
- `frontend/src/i18n/resources/de/pendingUpdates.json` — add enrichment badge keys
- `frontend/src/i18n/resources/en/pendingUpdates.json` — add enrichment badge keys

---

## Task 1: Create branch + DB migration

**Files:**
- Create: `backend/prisma/migrations/20260404000000_simplify_historical_enrichment/migration.sql`

- [ ] **Step 1: Create the feature branch**

```bash
cd /d/Projekte/TravStats
git checkout -b feature/enrichment-redesign
```

- [ ] **Step 2: Write the migration SQL**

Create `backend/prisma/migrations/20260404000000_simplify_historical_enrichment/migration.sql`:

```sql
-- Remove redundant historical enrichment columns from user_settings
-- These are replaced by hardcoded business logic:
--   maxAgeYears  → replaced by 1-year full/slim split in service
--   autoProcess  → scheduler always runs for enabled users
--   requireApproval → always true, not configurable
ALTER TABLE "user_settings"
  DROP COLUMN IF EXISTS "historical_enrichment_max_age_years",
  DROP COLUMN IF EXISTS "historical_enrichment_auto_process",
  DROP COLUMN IF EXISTS "historical_enrichment_require_approval";
```

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/migrations/20260404000000_simplify_historical_enrichment/
git commit -m "chore: migration — drop 3 redundant historical enrichment columns"
```

---

## Task 2: Prisma schema update

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Remove the 3 fields from UserSettings**

In `backend/prisma/schema.prisma`, find the `UserSettings` model and remove these three lines:

```prisma
  historicalEnrichmentMaxAgeYears   Int     @default(5)    @map("historical_enrichment_max_age_years")
  historicalEnrichmentAutoProcess   Boolean @default(false) @map("historical_enrichment_auto_process")
  historicalEnrichmentRequireApproval Boolean @default(true) @map("historical_enrichment_require_approval")
```

- [ ] **Step 2: Verify Prisma is happy**

```bash
cd /d/Projekte/TravStats/backend && npx prisma validate
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "chore: remove maxAgeYears, autoProcess, requireApproval from UserSettings schema"
```

---

## Task 3: Rewrite `flightEnrichmentService.ts` — interfaces + `getEnrichmentMode`

**Files:**
- Modify: `backend/src/services/flightEnrichmentService.ts`
- Create: `backend/src/services/__tests__/flightEnrichmentService.test.ts`

- [ ] **Step 1: Write failing tests for `getEnrichmentMode`**

Create `backend/src/services/__tests__/flightEnrichmentService.test.ts`:

```typescript
import { getEnrichmentMode } from '../flightEnrichmentService';

describe('getEnrichmentMode', () => {
  it('returns full for a flight 6 months ago', () => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    expect(getEnrichmentMode(sixMonthsAgo)).toBe('full');
  });

  it('returns full for a flight exactly 1 year ago (boundary)', () => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    oneYearAgo.setDate(oneYearAgo.getDate() + 1); // 1 day before crossing
    expect(getEnrichmentMode(oneYearAgo)).toBe('full');
  });

  it('returns slim for a flight 2 years ago', () => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    expect(getEnrichmentMode(twoYearsAgo)).toBe('slim');
  });

  it('returns slim for a flight 5 years ago', () => {
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    expect(getEnrichmentMode(fiveYearsAgo)).toBe('slim');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="flightEnrichmentService" --forceExit
```
Expected: FAIL — `getEnrichmentMode is not a function`

- [ ] **Step 3: Update interfaces in `flightEnrichmentService.ts`**

Replace the `UserEnrichmentSettings` interface (remove 3 fields) and add `EnrichmentMode`:

```typescript
export type EnrichmentMode = 'full' | 'slim';

export interface UserEnrichmentSettings {
  enabled: boolean;
  minConfidence: number;
  maxPerDay: number;
}

export interface EnrichmentCandidate {
  flightId: string;
  flightNumber: string;
  missingFields: string[];
  missingRoute: boolean;
  ageYears: number;
  confidence: number;
  enrichmentMode: EnrichmentMode;  // NEW
}
```

- [ ] **Step 4: Update `getUserEnrichmentSettings` to match new interface**

Replace the return block in `getUserEnrichmentSettings`:

```typescript
return {
  enabled: userSettings.historicalEnrichmentEnabled ?? false,
  minConfidence: userSettings.historicalEnrichmentMinConfidence ?? 60,
  maxPerDay: userSettings.historicalEnrichmentMaxPerDay ?? 50,
};
```

- [ ] **Step 5: Add `getEnrichmentMode` as an exported function**

Add after the `getUserEnrichmentSettings` function:

```typescript
/**
 * Determine enrichment mode based on flight age.
 * < 1 year  → full  (aircraft, ICAO, route, terminal, gate)
 * ≥ 1 year  → slim  (ICAO codes + terminal only)
 */
export function getEnrichmentMode(departureTime: Date): EnrichmentMode {
  const ageMs = Date.now() - departureTime.getTime();
  const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);
  return ageYears < 1 ? 'full' : 'slim';
}
```

- [ ] **Step 6: Run tests — verify they pass**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="flightEnrichmentService" --forceExit
```
Expected: PASS — 4 tests

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/flightEnrichmentService.ts backend/src/services/__tests__/flightEnrichmentService.test.ts
git commit -m "feat: add EnrichmentMode + getEnrichmentMode — full (<1yr) vs slim (≥1yr)"
```

---

## Task 4: Fix `findEnrichmentCandidates` — stop re-processing loop

**Files:**
- Modify: `backend/src/services/flightEnrichmentService.ts`
- Modify: `backend/src/services/__tests__/flightEnrichmentService.test.ts`

The current bug: the query only excludes `applied` updates. Flights with `pending` or `rejected` updates get re-queued every night.

- [ ] **Step 1: Add tests for the exclusion logic**

Add to `flightEnrichmentService.test.ts`:

```typescript
import { prisma } from '../../db';

// Mock prisma
jest.mock('../../db', () => ({
  prisma: {
    userSettings: { findUnique: jest.fn() },
    flight: { findMany: jest.fn() },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('findEnrichmentCandidates — exclusion filter', () => {
  beforeEach(() => {
    (mockPrisma.userSettings.findUnique as jest.Mock).mockResolvedValue({
      historicalEnrichmentEnabled: true,
      historicalEnrichmentMinConfidence: 60,
      historicalEnrichmentMaxPerDay: 50,
    });
  });

  it('returns empty array when enrichment is disabled', async () => {
    (mockPrisma.userSettings.findUnique as jest.Mock).mockResolvedValue({
      historicalEnrichmentEnabled: false,
      historicalEnrichmentMinConfidence: 60,
      historicalEnrichmentMaxPerDay: 50,
    });
    const result = await findEnrichmentCandidates('user-1');
    expect(result).toEqual([]);
  });

  it('passes correct status exclusion filter to prisma', async () => {
    (mockPrisma.flight.findMany as jest.Mock).mockResolvedValue([]);
    await findEnrichmentCandidates('user-1');

    const callArg = (mockPrisma.flight.findMany as jest.Mock).mock.calls[0][0];
    expect(callArg.where.NOT.pendingUpdates.some.status.in).toEqual(
      expect.arrayContaining(['applied', 'pending', 'rejected'])
    );
  });
});
```

- [ ] **Step 2: Run tests — verify exclusion test fails**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="flightEnrichmentService" --forceExit
```
Expected: FAIL — status filter does not contain `pending` or `rejected`

- [ ] **Step 3: Fix the filter in `findEnrichmentCandidates`**

In `findEnrichmentCandidates`, replace the `NOT` block in the Prisma query:

```typescript
NOT: {
  pendingUpdates: {
    some: {
      status: { in: ['applied', 'pending', 'rejected'] },
    },
  },
},
```

Also add `enrichmentMode` to the candidate push:

```typescript
candidates.push({
  flightId: flight.id,
  flightNumber: flight.flightNumber!,
  missingFields,
  missingRoute,
  ageYears,
  confidence,
  enrichmentMode: getEnrichmentMode(flight.departureTime),
});
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="flightEnrichmentService" --forceExit
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/flightEnrichmentService.ts backend/src/services/__tests__/flightEnrichmentService.test.ts
git commit -m "fix: exclude pending+rejected flights from enrichment candidates — stops nightly re-processing loop"
```

---

## Task 5: Slim mode in `aggregateFlightData`

**Files:**
- Modify: `backend/src/services/flightEnrichmentService.ts`
- Modify: `backend/src/services/__tests__/flightEnrichmentService.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `flightEnrichmentService.test.ts`:

```typescript
describe('aggregateFlightData — slim mode', () => {
  const mockReferenceFlights = Array.from({ length: 5 }, (_, i) => ({
    id: `ref-${i}`,
    flightNumber: 'LH400',
    aircraft: 'A380',
    depIcao: 'EDDF',
    depIata: 'FRA',
    arrIcao: 'KJFK',
    arrIata: 'JFK',
    gate: 'Z12',
    terminal: '1',
    actualRoute: [{ lat: 50.0, lon: 8.0 }, { lat: 40.0, lon: -73.0 }],
    hasLiveTracking: true,
    departureTime: new Date(),
    overflownCountries: ['DE', 'FR', 'US'],
  }));

  beforeEach(() => {
    (mockPrisma.flight.findMany as jest.Mock).mockResolvedValue(mockReferenceFlights);
  });

  it('slim mode does not include aircraft or route', async () => {
    const result = await aggregateFlightData('LH400', 'exclude-id', 5, 'slim');
    expect(result).not.toBeNull();
    expect(result!.aircraft).toBeUndefined();
    expect(result!.typicalRoute).toBeUndefined();
  });

  it('slim mode still includes depIcao and terminal', async () => {
    const result = await aggregateFlightData('LH400', 'exclude-id', 5, 'slim');
    expect(result!.depIcao).toBe('EDDF');
    expect(result!.terminal).toBe('1');
  });

  it('full mode includes aircraft and route', async () => {
    const result = await aggregateFlightData('LH400', 'exclude-id', 5, 'full');
    expect(result!.aircraft).toBe('A380');
    expect(result!.typicalRoute).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="flightEnrichmentService" --forceExit
```
Expected: FAIL — `aggregateFlightData` doesn't accept a mode parameter

- [ ] **Step 3: Add `mode` parameter to `aggregateFlightData`**

Change the function signature:

```typescript
export async function aggregateFlightData(
  flightNumber: string,
  excludeFlightId: string,
  minFlights: number = 5,
  mode: EnrichmentMode = 'full'
): Promise<AggregatedFlightData | null> {
```

Inside the function, wrap the full-mode-only fields:

```typescript
// Aggregate basic fields (always collected)
const depIcaos = referenceFlights.map(f => f.depIcao).filter(Boolean) as string[];
const arrIcaos = referenceFlights.map(f => f.arrIcao).filter(Boolean) as string[];
const terminals = referenceFlights.map(f => f.terminal).filter(Boolean) as string[];

const mostCommonDepIcao = getMostCommon(depIcaos);
const mostCommonArrIcao = getMostCommon(arrIcaos);
const mostCommonTerminal = getMostCommon(terminals);

// Full-mode-only fields
let mostCommonAircraft: string | undefined;
let mostCommonGate: string | undefined;
let typicalRoute: AggregatedFlightData['typicalRoute'];
let routeConsistency: 'high' | 'medium' | 'low' = 'low';

if (mode === 'full') {
  const aircrafts = referenceFlights.map(f => f.aircraft).filter(Boolean) as string[];
  const gates = referenceFlights.map(f => f.gate).filter(Boolean) as string[];
  mostCommonAircraft = getMostCommon(aircrafts);
  mostCommonGate = getMostCommon(gates);

  const routes = referenceFlights
    .map(f => f.actualRoute)
    .filter(Boolean) as Prisma.JsonValue[];
  typicalRoute = aggregateRoutes(routes);
  routeConsistency = calculateRouteConsistency(routes);
}

const anomalies = detectRouteAnomalies(referenceFlights, {
  aircraft: mostCommonAircraft,
  routeConsistency,
});

const confidence = calculateConfidence(
  referenceFlights.length,
  routeConsistency,
  anomalies,
  referenceFlights[0]?.departureTime
    ? (Date.now() - referenceFlights[0].departureTime.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
    : 0
);

return {
  aircraft: mostCommonAircraft,
  depIcao: mostCommonDepIcao,
  depIata: referenceFlights[0]?.depIata ?? undefined,
  arrIcao: mostCommonArrIcao,
  arrIata: referenceFlights[0]?.arrIata ?? undefined,
  gate: mostCommonGate,
  terminal: mostCommonTerminal,
  typicalRoute,
  sourceFlightsCount: referenceFlights.length,
  confidence,
  anomalies,
  routeConsistency,
};
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="flightEnrichmentService" --forceExit
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/flightEnrichmentService.ts backend/src/services/__tests__/flightEnrichmentService.test.ts
git commit -m "feat: slim enrichment mode — skip aircraft+route for flights ≥1 year old"
```

---

## Task 6: Improve route aggregation — median interpolation

**Files:**
- Modify: `backend/src/services/flightEnrichmentService.ts`
- Modify: `backend/src/services/__tests__/flightEnrichmentService.test.ts`

Currently `aggregateRoutes` just takes `routes[0]` (newest). This task replaces it with resampling + median.

- [ ] **Step 1: Write failing test**

Add to `flightEnrichmentService.test.ts`:

```typescript
describe('aggregateRoutes (median interpolation)', () => {
  it('returns a route with exactly RESAMPLE_POINTS waypoints for consistent routes', () => {
    // Two routes with same shape but different waypoint counts
    const route1 = [
      { lat: 50.0, lon: 8.0 },
      { lat: 45.0, lon: 2.0 },
      { lat: 40.0, lon: -73.0 },
    ];
    const route2 = [
      { lat: 50.1, lon: 8.1 },
      { lat: 44.9, lon: 1.9 },
      { lat: 39.9, lon: -73.1 },
    ];
    // Access via the exported helper (we'll export it for testing)
    const result = aggregateRoutesForTest([route1, route2]);
    expect(result).not.toBeUndefined();
    expect(result!.waypoints.length).toBe(20); // RESAMPLE_POINTS = 20
  });

  it('returns median lat/lon — outlier route does not dominate', () => {
    const normal1 = [{ lat: 50.0, lon: 8.0 }, { lat: 40.0, lon: -73.0 }];
    const normal2 = [{ lat: 50.0, lon: 8.0 }, { lat: 40.0, lon: -73.0 }];
    const outlier = [{ lat: 60.0, lon: 8.0 }, { lat: 40.0, lon: -73.0 }]; // diverges at start
    const result = aggregateRoutesForTest([normal1, normal2, outlier]);
    expect(result).not.toBeUndefined();
    // First waypoint median lat should be close to 50, not 60
    expect(result!.waypoints[0].lat).toBeCloseTo(50.0, 0);
  });
});
```

Note: `aggregateRoutesForTest` needs to be exported from the service for testing.

- [ ] **Step 2: Run test — verify it fails**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="flightEnrichmentService" --forceExit
```
Expected: FAIL — `aggregateRoutesForTest is not a function`

- [ ] **Step 3: Replace `aggregateRoutes` with median interpolation**

Replace the entire `aggregateRoutes` function and add helpers:

```typescript
const RESAMPLE_POINTS = 20;

/** Compute cumulative distances along a route */
function cumulativeDistances(wps: Array<{ lat: number; lon: number }>): number[] {
  const dists = [0];
  for (let i = 1; i < wps.length; i++) {
    const dlat = wps[i].lat - wps[i - 1].lat;
    const dlon = wps[i].lon - wps[i - 1].lon;
    dists.push(dists[i - 1] + Math.sqrt(dlat * dlat + dlon * dlon));
  }
  return dists;
}

/** Resample a route to exactly n evenly-spaced points */
function resampleRoute(
  wps: Array<{ lat: number; lon: number }>,
  n: number
): Array<{ lat: number; lon: number }> {
  if (wps.length === 0) return [];
  if (wps.length === 1) return Array(n).fill(wps[0]);

  const dists = cumulativeDistances(wps);
  const total = dists[dists.length - 1];
  if (total === 0) return Array(n).fill(wps[0]);

  const result: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    // Find segment
    let seg = dists.findIndex((d, idx) => idx > 0 && dists[idx - 1] <= target && d >= target);
    if (seg <= 0) seg = 1;
    const segStart = dists[seg - 1];
    const segEnd = dists[seg];
    const t = segEnd === segStart ? 0 : (target - segStart) / (segEnd - segStart);
    result.push({
      lat: wps[seg - 1].lat + t * (wps[seg].lat - wps[seg - 1].lat),
      lon: wps[seg - 1].lon + t * (wps[seg].lon - wps[seg - 1].lon),
    });
  }
  return result;
}

/** Return median of a number array */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Aggregate multiple routes into a single typical route using
 * resampling + median per position.
 * Exported for testing as aggregateRoutesForTest.
 */
export function aggregateRoutesForTest(
  rawRoutes: Array<Array<{ lat: number; lon: number }>>
): { waypoints: Array<{ lat: number; lon: number }>; overflownCountries: string[]; routeDistance: number } | undefined {
  const validRoutes = rawRoutes.filter(r => r.length >= 2);
  if (validRoutes.length === 0) return undefined;

  const resampled = validRoutes.map(r => resampleRoute(r, RESAMPLE_POINTS));

  const waypoints: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < RESAMPLE_POINTS; i++) {
    waypoints.push({
      lat: median(resampled.map(r => r[i].lat)),
      lon: median(resampled.map(r => r[i].lon)),
    });
  }

  const dists = cumulativeDistances(waypoints);
  const routeDistance = dists[dists.length - 1] * 111; // rough deg→km

  return { waypoints, overflownCountries: [], routeDistance };
}

/**
 * Aggregate routes from Prisma JsonValue array.
 * Internal wrapper used by aggregateFlightData.
 */
function aggregateRoutes(routes: Prisma.JsonValue[]): AggregatedFlightData['typicalRoute'] {
  const parsed = routes
    .filter(Array.isArray)
    .map(r =>
      (r as Prisma.JsonValue[])
        .filter(
          (wp): wp is Prisma.JsonObject =>
            typeof wp === 'object' && wp !== null && !Array.isArray(wp) &&
            typeof wp['lat'] === 'number' && typeof wp['lon'] === 'number'
        )
        .map(wp => ({ lat: wp['lat'] as number, lon: wp['lon'] as number }))
    )
    .filter(r => r.length >= 2);

  const result = aggregateRoutesForTest(parsed);
  if (!result) return undefined;

  // Collect countries from all routes
  const allCountries = new Set<string>();
  for (const route of routes) {
    if (Array.isArray(route)) {
      for (const wp of route) {
        if (
          typeof wp === 'object' && wp !== null && !Array.isArray(wp) &&
          typeof (wp as Prisma.JsonObject)['country'] === 'string'
        ) {
          allCountries.add((wp as Prisma.JsonObject)['country'] as string);
        }
      }
    }
  }

  return {
    ...result,
    overflownCountries: Array.from(allCountries),
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="flightEnrichmentService" --forceExit
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/flightEnrichmentService.ts backend/src/services/__tests__/flightEnrichmentService.test.ts
git commit -m "feat: route aggregation — replace newest-only with resampling+median interpolation"
```

---

## Task 7: Update `createHistoricalEnrichment` — mode-aware + always-approval

**Files:**
- Modify: `backend/src/services/flightEnrichmentService.ts`

- [ ] **Step 1: Update `createHistoricalEnrichment`**

In the function, after fetching the flight, determine mode and build mode-aware `proposedData`:

```typescript
const mode = getEnrichmentMode(flight.departureTime);
```

Replace the `proposedData` block:

```typescript
const proposedData = mode === 'full'
  ? {
      ...originalData,
      aircraft: aggregatedData.aircraft || flight.aircraft,
      depIcao: aggregatedData.depIcao || flight.depIcao,
      depIata: aggregatedData.depIata || flight.depIata,
      arrIcao: aggregatedData.arrIcao || flight.arrIcao,
      arrIata: aggregatedData.arrIata || flight.arrIata,
      gate: aggregatedData.gate || flight.gate,
      terminal: aggregatedData.terminal || flight.terminal,
      actualRoute: aggregatedData.typicalRoute?.waypoints || flight.actualRoute,
      overflownCountries: aggregatedData.typicalRoute?.overflownCountries || flight.overflownCountries,
      routeDistance: aggregatedData.typicalRoute?.routeDistance || flight.routeDistance,
    }
  : {
      // Slim mode: only ICAO codes + terminal
      ...originalData,
      depIcao: aggregatedData.depIcao || flight.depIcao,
      depIata: aggregatedData.depIata || flight.depIata,
      arrIcao: aggregatedData.arrIcao || flight.arrIcao,
      arrIata: aggregatedData.arrIata || flight.arrIata,
      terminal: aggregatedData.terminal || flight.terminal,
    };
```

Update `metadata` to include `enrichmentMode`:

```typescript
const metadata = {
  sourceFlightsCount: aggregatedData.sourceFlightsCount,
  confidence: aggregatedData.confidence,
  anomalies: aggregatedData.anomalies,
  isHistoricalEnrichment: true,
  enrichmentMode: mode,
  routeConsistency: aggregatedData.routeConsistency,
};
```

- [ ] **Step 2: Run full backend type check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Run tests**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="flightEnrichmentService" --forceExit
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/flightEnrichmentService.ts
git commit -m "feat: createHistoricalEnrichment — mode-aware proposedData, always requireApproval"
```

---

## Task 8: Simplify scheduler + settings route

**Files:**
- Modify: `backend/src/jobs/historicalEnrichmentScheduler.ts`
- Modify: `backend/src/routes/settings/general.ts`

- [ ] **Step 1: Remove `autoProcess` gate from scheduler**

In `historicalEnrichmentScheduler.ts`, update `processUserHistoricalEnrichment`:

Replace the early-return check:
```typescript
// BEFORE:
if (!settings || !settings.enabled || !settings.autoProcess) {
  return { processed: 0, created: 0, skipped: 0 };
}
```
With:
```typescript
// AFTER (always run for all enabled users):
if (!settings || !settings.enabled) {
  return { processed: 0, created: 0, skipped: 0 };
}
```

In `processAllUsersHistoricalEnrichment`, update the Prisma query:

```typescript
// BEFORE:
const users = await prisma.userSettings.findMany({
  where: {
    historicalEnrichmentEnabled: true,
    historicalEnrichmentAutoProcess: true,
  },
  ...
});

// AFTER:
const users = await prisma.userSettings.findMany({
  where: {
    historicalEnrichmentEnabled: true,
  },
  select: { userId: true },
});
```

- [ ] **Step 2: Simplify `routes/settings/general.ts`**

Update the Zod schema — remove 3 fields:

```typescript
historicalEnrichment: z.object({
  enabled: z.boolean().optional(),
  minConfidence: z.number().min(0).max(100).optional(),
  maxPerDay: z.number().min(1).max(1000).optional(),
}).partial().optional(),
```

Update `buildSettingsResponse` — remove 3 fields:

```typescript
historicalEnrichment: {
  enabled: record.historicalEnrichmentEnabled ?? false,
  minConfidence: record.historicalEnrichmentMinConfidence ?? 60,
  maxPerDay: record.historicalEnrichmentMaxPerDay ?? 50,
},
```

Update GET handler defaults — remove 3 fields:

```typescript
historicalEnrichmentEnabled: false,
historicalEnrichmentMinConfidence: 60,
historicalEnrichmentMaxPerDay: 50,
```

Update PUT handler — remove the 3 field blocks for `maxAgeYears`, `autoProcess`, `requireApproval`. Also update the `else` branch (preserve existing) to only preserve the remaining 3 fields:

```typescript
} else if (existing) {
  updateData.historicalEnrichmentEnabled = existing.historicalEnrichmentEnabled;
  updateData.historicalEnrichmentMinConfidence = existing.historicalEnrichmentMinConfidence;
  updateData.historicalEnrichmentMaxPerDay = existing.historicalEnrichmentMaxPerDay;
}
```

Update the upsert create data:

```typescript
historicalEnrichmentEnabled: payload.historicalEnrichment?.enabled ?? false,
historicalEnrichmentMinConfidence: payload.historicalEnrichment?.minConfidence ?? 60,
historicalEnrichmentMaxPerDay: payload.historicalEnrichment?.maxPerDay ?? 50,
```

- [ ] **Step 3: Type check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/jobs/historicalEnrichmentScheduler.ts backend/src/routes/settings/general.ts
git commit -m "refactor: scheduler always runs for enabled users, simplify settings schema to 3 fields"
```

---

## Task 9: Frontend — update `useSettingsPage.ts` + `EnrichmentSection.tsx`

**Files:**
- Modify: `frontend/src/components/Settings/useSettingsPage.ts`
- Modify: `frontend/src/components/Settings/EnrichmentSection.tsx`

- [ ] **Step 1: Update `useSettingsPage.ts`**

Replace the `HistoricalEnrichmentSettings` initial state (around line 99):

```typescript
const [historicalEnrichmentSettings, setHistoricalEnrichmentSettings] =
  useState({
    enabled: false,
    minConfidence: 60,
    maxPerDay: 50,
  });
```

Update the load block (around line 149):

```typescript
enabled: settings.historicalEnrichment?.enabled ?? false,
minConfidence: settings.historicalEnrichment?.minConfidence ?? 60,
maxPerDay: settings.historicalEnrichment?.maxPerDay ?? 50,
```

- [ ] **Step 2: Rewrite `EnrichmentSection.tsx`**

Replace the entire file content:

```tsx
import { AmberToggle, SectionCard, SectionTitle } from "./SettingsShared";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

interface HistoricalEnrichmentSettings {
  enabled: boolean;
  minConfidence: number;
  maxPerDay: number;
}

interface EnrichmentSectionProps {
  historicalEnrichmentSettings: HistoricalEnrichmentSettings;
  loadingHistoricalEnrichmentSettings: boolean;
  onSetHistoricalEnrichmentSettings: (settings: HistoricalEnrichmentSettings) => void;
  onSave: () => void;
}

export default function EnrichmentSection({
  historicalEnrichmentSettings,
  loadingHistoricalEnrichmentSettings,
  onSetHistoricalEnrichmentSettings,
  onSave,
}: EnrichmentSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);

  return (
    <SectionCard>
      <div className="flex items-center gap-2">
        <SectionTitle
          title={t("settings:historicalEnrichment.title")}
          description={t("settings:historicalEnrichment.description")}
        />
        <span
          className="px-2 py-0.5 text-xs font-semibold rounded-full self-start mt-1"
          style={{ background: "rgba(232,160,69,0.15)", color: "var(--accent)" }}
        >
          Beta
        </span>
      </div>

      <InlineHelp
        title={t("settings:historicalEnrichment.info.title")}
        category="basic"
        content={
          <div className="space-y-3">
            <p>{t("settings:historicalEnrichment.info.description")}</p>

            {/* Two-mode explanation */}
            <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--bg-base)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {t("settings:historicalEnrichment.info.modes.title")}
              </p>
              <div className="flex gap-2 items-start">
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full whitespace-nowrap"
                  style={{ background: "rgba(34,197,94,0.15)", color: "rgb(22,163,74)" }}>
                  {t("settings:historicalEnrichment.info.modes.fullLabel")}
                </span>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {t("settings:historicalEnrichment.info.modes.fullDescription")}
                </p>
              </div>
              <div className="flex gap-2 items-start">
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full whitespace-nowrap"
                  style={{ background: "rgba(232,160,69,0.15)", color: "var(--accent)" }}>
                  {t("settings:historicalEnrichment.info.modes.slimLabel")}
                </span>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {t("settings:historicalEnrichment.info.modes.slimDescription")}
                </p>
              </div>
            </div>

            <div
              className="rounded-lg p-3"
              style={{
                background: "rgba(232,160,69,0.1)",
                border: "1px solid rgba(232,160,69,0.3)",
              }}
            >
              <p className="font-semibold mb-1 text-sm" style={{ color: "var(--accent)" }}>
                {t("settings:historicalEnrichment.info.warning.title")}
              </p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {t("settings:historicalEnrichment.info.warning.description")}
              </p>
            </div>
          </div>
        }
      />

      <div className="space-y-4">
        <label className="flex items-center gap-3">
          <AmberToggle
            checked={historicalEnrichmentSettings.enabled}
            onChange={(e) =>
              onSetHistoricalEnrichmentSettings({
                ...historicalEnrichmentSettings,
                enabled: e.target.checked,
              })
            }
          />
          <span style={{ color: "var(--text-primary)" }}>
            {t("settings:historicalEnrichment.enabled")}
          </span>
        </label>

        {historicalEnrichmentSettings.enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">
                {t("settings:historicalEnrichment.minConfidence")}
              </label>
              <input
                type="number"
                value={historicalEnrichmentSettings.minConfidence}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  if (value >= 0 && value <= 100) {
                    onSetHistoricalEnrichmentSettings({
                      ...historicalEnrichmentSettings,
                      minConfidence: value,
                    });
                  }
                }}
                min="0"
                max="100"
                className="input"
              />
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {t("settings:historicalEnrichment.minConfidenceDescription")}
              </p>
            </div>
            <div>
              <label className="label">
                {t("settings:historicalEnrichment.maxPerDay")}
              </label>
              <input
                type="number"
                value={historicalEnrichmentSettings.maxPerDay}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  if (value >= 1 && value <= 1000) {
                    onSetHistoricalEnrichmentSettings({
                      ...historicalEnrichmentSettings,
                      maxPerDay: value,
                    });
                  }
                }}
                min="1"
                max="1000"
                className="input"
              />
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {t("settings:historicalEnrichment.maxPerDayDescription")}
              </p>
            </div>
          </div>
        )}

        <div
          className="flex justify-end pt-4"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <button
            onClick={onSave}
            disabled={loadingHistoricalEnrichmentSettings}
            className="btn-primary"
            style={{ boxShadow: "0 0 16px rgba(232,160,69,0.25)" }}
          >
            {loadingHistoricalEnrichmentSettings
              ? t("common:buttons.saving")
              : t("common:buttons.save")}
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 3: Frontend type check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Settings/EnrichmentSection.tsx frontend/src/components/Settings/useSettingsPage.ts
git commit -m "feat: enrichment settings UI — 3 fields, two-mode explanation panel"
```

---

## Task 10: Frontend — enrichment badge in `PendingUpdateCard.tsx`

**Files:**
- Modify: `frontend/src/components/PendingUpdateCard.tsx`

- [ ] **Step 1: Extend `PendingUpdate` interface with metadata**

Add to the `PendingUpdate` interface:

```typescript
metadata?: {
  isHistoricalEnrichment?: boolean;
  enrichmentMode?: 'full' | 'slim';
  confidence?: number;
  sourceFlightsCount?: number;
};
```

- [ ] **Step 2: Add enrichment badge + Vorschlag hint to the header**

Replace the `getApiSourceLabel` function:

```typescript
const getApiSourceLabel = (source: string): string => {
  const labels: Record<string, string> = {
    historical_aggregation: t("pendingUpdates:apiSource.historicalAggregation"),
    airlabs: "AirLabs API",
    aviationstack: "Aviationstack API",
    opensky: "OpenSky Network",
  };
  return labels[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
};
```

In the header div (after the existing status + apiSource span), add the enrichment badge:

```tsx
{/* After: <span className="text-xs text-[var(--text-muted)]">{getApiSourceLabel(update.apiSource)}</span> */}
{update.metadata?.isHistoricalEnrichment && (
  <span
    className="px-2 py-0.5 text-xs font-semibold rounded-full"
    style={{
      background: update.metadata.enrichmentMode === 'full'
        ? "rgba(34,197,94,0.15)"
        : "rgba(232,160,69,0.15)",
      color: update.metadata.enrichmentMode === 'full'
        ? "rgb(22,163,74)"
        : "var(--accent)",
    }}
  >
    {update.metadata.enrichmentMode === 'full'
      ? t("pendingUpdates:enrichment.fullBadge")
      : t("pendingUpdates:enrichment.slimBadge")}
  </span>
)}
```

Below the flight header info block, add the "Vorschlag" disclaimer:

```tsx
{update.metadata?.isHistoricalEnrichment && (
  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
    {t("pendingUpdates:enrichment.disclaimer", {
      count: update.metadata.sourceFlightsCount ?? 0,
      confidence: update.metadata.confidence ?? 0,
    })}
  </p>
)}
```

- [ ] **Step 3: Frontend type check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PendingUpdateCard.tsx
git commit -m "feat: PendingUpdateCard — enrichment mode badge + Vorschlag disclaimer"
```

---

## Task 11: i18n updates

**Files:**
- Modify: `frontend/src/i18n/resources/de/settings.json`
- Modify: `frontend/src/i18n/resources/en/settings.json`
- Modify: `frontend/src/i18n/resources/de/pendingUpdates.json`
- Modify: `frontend/src/i18n/resources/en/pendingUpdates.json`

- [ ] **Step 1: Update `de/settings.json` — historicalEnrichment block**

Replace the entire `"historicalEnrichment"` section:

```json
"historicalEnrichment": {
  "title": "Historische Anreicherung",
  "description": "Ergänzt Flüge mit fehlenden Daten durch Aggregation von Referenzflügen derselben Flugnummer",
  "info": {
    "title": "Wie funktioniert die historische Anreicherung?",
    "description": "Das System sucht Flüge mit derselben Flugnummer, die live getrackt wurden, und aggregiert deren Daten. Je nach Alter des Fluges werden unterschiedliche Felder ergänzt.",
    "modes": {
      "title": "Zwei Anreicherungs-Modi:",
      "fullLabel": "Vollständig",
      "fullDescription": "Flüge < 1 Jahr: Flugzeugtyp, ICAO-Codes, Route, Terminal, Gate werden ergänzt.",
      "slimLabel": "Basis",
      "slimDescription": "Flüge ≥ 1 Jahr: Nur ICAO-Codes und Terminal — Flugzeugtyp und Route sind zu unsicher für ältere Flüge."
    },
    "warning": {
      "title": "Wichtig:",
      "description": "Alle Vorschläge sind Schätzungen basierend auf ähnlichen Flügen. Jede Anreicherung muss manuell bestätigt werden bevor sie gespeichert wird."
    }
  },
  "enabled": "Historische Flugdaten-Anreicherung aktivieren",
  "minConfidence": "Min. Konfidenz (%)",
  "minConfidenceDescription": "Nur Vorschläge mit mindestens X% Konfidenz anzeigen",
  "maxPerDay": "Max. pro Tag",
  "maxPerDayDescription": "Maximale Anzahl neuer Vorschläge pro Nacht",
  "saved": "Anreicherungs-Einstellungen gespeichert",
  "saveFailed": "Fehler beim Speichern der Anreicherungs-Einstellungen"
}
```

- [ ] **Step 2: Update `en/settings.json` — historicalEnrichment block**

Replace the entire `"historicalEnrichment"` section:

```json
"historicalEnrichment": {
  "title": "Historical Enrichment",
  "description": "Fills in missing flight data by aggregating reference flights with the same flight number",
  "info": {
    "title": "How does historical enrichment work?",
    "description": "The system finds flights with the same flight number that were live-tracked and aggregates their data. Depending on the age of the flight, different fields are filled in.",
    "modes": {
      "title": "Two enrichment modes:",
      "fullLabel": "Full",
      "fullDescription": "Flights < 1 year: aircraft type, ICAO codes, route, terminal, and gate are filled in.",
      "slimLabel": "Basic",
      "slimDescription": "Flights ≥ 1 year: Only ICAO codes and terminal — aircraft type and route are too unreliable for older flights."
    },
    "warning": {
      "title": "Important:",
      "description": "All suggestions are estimates based on similar flights. Each enrichment must be manually confirmed before it is saved."
    }
  },
  "enabled": "Enable historical flight data enrichment",
  "minConfidence": "Min. Confidence (%)",
  "minConfidenceDescription": "Only show suggestions with at least X% confidence",
  "maxPerDay": "Max. per Day",
  "maxPerDayDescription": "Maximum number of new suggestions per night",
  "saved": "Enrichment settings saved successfully",
  "saveFailed": "Failed to save enrichment settings"
}
```

- [ ] **Step 3: Add enrichment keys to `de/pendingUpdates.json`**

Add inside the `"apiSource"` object:

```json
"apiSource": {
  "airlabs": "AirLabs API",
  "aviationstack": "Aviationstack API",
  "opensky": "OpenSky Network",
  "historicalAggregation": "Historische Anreicherung"
}
```

Add a new top-level `"enrichment"` key:

```json
"enrichment": {
  "fullBadge": "Vollständig",
  "slimBadge": "Basis",
  "disclaimer": "Vorschlag · nicht verifiziert · basiert auf {{count}} Referenzflügen ({{confidence}}% Konfidenz)"
}
```

- [ ] **Step 4: Add enrichment keys to `en/pendingUpdates.json`**

Add inside the `"apiSource"` object:

```json
"historicalAggregation": "Historical Enrichment"
```

Add new top-level `"enrichment"` key:

```json
"enrichment": {
  "fullBadge": "Full",
  "slimBadge": "Basic",
  "disclaimer": "Suggestion · unverified · based on {{count}} reference flights ({{confidence}}% confidence)"
}
```

- [ ] **Step 5: Frontend type check + lint**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npm run lint
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/i18n/
git commit -m "feat: i18n — update enrichment settings keys, add enrichment badge keys to pendingUpdates"
```

---

## Task 12: Final build check + full test run

- [ ] **Step 1: Backend type check + lint + tests**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit && npm run lint && npx jest --forceExit
```
Expected: all pass (backend tests requiring DB will skip/fail — that is expected)

- [ ] **Step 2: Frontend type check + lint + tests**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```
Expected: all pass

- [ ] **Step 3: Final commit if any lint fixes were needed**

```bash
git add -p  # stage only lint fixes
git commit -m "fix: lint — enrichment redesign cleanup"
```

- [ ] **Step 4: Push branch**

```bash
git push -u origin feature/enrichment-redesign
```
