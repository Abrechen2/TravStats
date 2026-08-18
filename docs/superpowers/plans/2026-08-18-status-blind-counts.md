# Status-Blind Counts Fix Package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Planned/scheduled flights, cruises, lodging stays and trips must never be counted or labelled as completed — one rule, applied at every confirmed defect site.

**Architecture:** Reuse the four existing done-predicates (see spec) — no new
status logic is invented. Backend queries gain status filters or compute
counts through the shared predicates; the frontend map/tooltip layer splits
`count` into `flownCount`/`scheduledCount` and renders honest labels.

**Tech Stack:** Express/TypeScript + Prisma + Jest (backend, DB on
localhost:5433/flights_dev), React/TypeScript + Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-08-18-status-blind-counts-findings.md`

## Global Constraints

- Branch: `fix/status-blind-counts` (already created off `main` = `9ff99669`).
- `any` is FORBIDDEN (use `unknown` + guards); TypeScript strict.
- i18n: every new/changed user-facing string updates **DE and EN together**.
- TDD every behavior change: watch the test FAIL before implementing.
- Do NOT touch `backend/VERSION` / `CHANGELOG.md` (owned by /deploy).
- Do NOT "fix" anything listed under "Verified correct" or "Deferred" in the spec.
- Backend tests: `cd backend && npx jest <file> --forceExit`. Frontend:
  `cd frontend && npx vitest --run <file>`.
- Commit after each task (`fix: …` conventional message, English).

---

### Task 1: `GET /stats/countries` — visited means flown

**Files:**
- Modify: `backend/src/routes/stats.ts:1185-1194`
- Test: `backend/src/__tests__/stats.countriesScheduledLeak.test.ts` (create)

**Interfaces:**
- Consumes: existing route; flight done-predicate `status: { in: ['flown', 'historical'] }`.
- Produces: no shape change — same response, filtered rows.

- [ ] **Step 1: Write the failing test.** Mirror the seeding style of
  `backend/src/__tests__/stats.scheduledLeakHighestAirport.test.ts` (same
  helpers, same auth pattern — read it first). Seed one `flown` flight
  FRA→JFK and one `scheduled` flight FRA→GRU (Brazil) for a fresh user, then:

```ts
it('does not count a scheduled flight as a visited country', async () => {
  const res = await request(app)
    .get('/api/v1/stats/countries')
    .set('Cookie', authCookie)
    .expect(200);
  const codes = res.body.countries.map((c: { country: string }) => c.country);
  expect(codes).toContain('US');
  expect(codes).not.toContain('BR');
});
```

  (Adapt the response-shape access to what the endpoint actually returns —
  read the handler's tail before asserting; the point is: the scheduled
  flight's country must be absent.)

- [ ] **Step 2: Run it, watch it FAIL** (BR present).
- [ ] **Step 3: Implement** — in `routes/stats.ts` change the query:

```ts
const flights = await prisma.flight.findMany({
  where: { userId, status: { in: ['flown', 'historical'] } },
  select: { depIata: true, depIcao: true, arrIata: true, arrIcao: true, departureTime: true },
});
```

- [ ] **Step 4: Run the new test (PASS) and the whole `stats`-related suites.**
- [ ] **Step 5: Commit** — `fix(stats): a scheduled flight does not visit a country`

---

### Task 2: `GET /stats/cruise` — "gefahren" numbers from sailed cruises only

**Files:**
- Modify: `backend/src/routes/stats.ts:1287-1288`
- Test: `backend/src/__tests__/stats.cruiseScheduledLeak.test.ts` (create)

**Interfaces:**
- Produces: same `CruiseStatsResponse` shape, rows filtered to
  `status: { in: ['flown', 'historical'] }`. Frontend
  `cruiseStatsAdapter.ts` needs NO change (verify only).

- [ ] **Step 1: Write the failing test.** Seed for a fresh user: one `flown`
  cruise (2 port stops, e.g. DE+NO ports) and one `scheduled` cruise (2 stops
  in new countries, future dates, some `distanceKm` on its legs). Assert:

```ts
const res = await request(app).get('/api/v1/stats/cruise').set('Cookie', authCookie).expect(200);
expect(res.body.cruisesCount).toBe(1);
expect(res.body.totalPortCalls).toBe(2);
expect(res.body.countries).not.toEqual(expect.arrayContaining(['<scheduled-cruise-country-name>']));
```

- [ ] **Step 2: Run, watch FAIL** (cruisesCount 2).
- [ ] **Step 3: Implement:**

```ts
where: { userId, status: { in: ['flown', 'historical'] } },
```

- [ ] **Step 4: New test PASS + existing cruise stats suites green.** Also
  verify (read, no change): `frontend/src/lib/stats/domain-stats/cruiseStatsAdapter.ts`
  headline KPIs now agree with its already-filtered time series.
- [ ] **Step 5: Commit** — `fix(stats): cruise figures count sailed cruises, not bookings`

---

### Task 3: Achievements — nothing unlocks from a booking

**Files:**
- Modify: `backend/src/utils/achievements.ts` (cruise query `:69-71`; trips query `:93-106`; tripDomainCounts `:277-281`; flyAndSail `:285-287`; tripsFullyDocumented `:398-404`)
- Test: `backend/src/utils/__tests__/achievements.cruiseScheduledLeak.test.ts` (create)

**Interfaces:**
- Consumes: `classifyStay` from `../shared/lodgingCounting` (already imported
  in the file? check — import it if not).
- Produces: `TripDomainCounts` values computed from DONE items only.

- [ ] **Step 1: Write the failing test.** Mirror
  `backend/src/utils/__tests__/achievementsCruise.integration.test.ts`
  (which only seeds `flown` — read it first). Seed ONLY a `scheduled` cruise
  with 5 stops/ports and run the engine:

```ts
await checkAndUnlockAchievements(userId);
const unlocked = await prisma.userAchievement.findMany({ where: { userId } });
const ids = unlocked.map((u) => u.achievementId);
expect(ids.filter((id) => id.startsWith('cruise'))).toEqual([]);
```

  Add a second case: a trip containing one `scheduled` flight + one future
  lodging stay must NOT set `flyAndStay`.

- [ ] **Step 2: Run, watch FAIL** (cruise achievements unlock).
- [ ] **Step 3: Implement:**
  1. Cruise query → `where: { userId, status: { in: ['flown', 'historical'] } }`.
     (This automatically fixes the port-country union at `:309-317` and
     Fly & Sail — but Fly & Sail also reads `c.trip.flights` /
     `c.trip.cruises`: filter those in the include or post-filter:
     `c.trip.flights.filter((f) => f.status === 'flown' || f.status === 'historical').length > 0`.)
  2. Trips query: replace the domain `_count`s with minimal selects and
     compute in JS through the shared predicates (a DB `where` cannot express
     `classifyStay`):

```ts
prisma.trip.findMany({
  where: { userId },
  select: {
    flights: { select: { status: true } },
    cruises: { select: { status: true } },
    lodgingStays: { select: { status: true, checkIn: true, checkOut: true } },
    _count: { select: { journalEntries: true, photos: true } },
  },
}),
```

```ts
const isDoneFlight = (s: string) => s === 'flown' || s === 'historical';
const isDoneCruise = isDoneFlight;
const doneStays = (t: (typeof trips)[number]) =>
  t.lodgingStays.filter((s) => classifyStay(s) === 'visited').length;
const tripDomainCounts: TripDomainCounts[] = trips.map((t) => ({
  flightCount: t.flights.filter((f) => isDoneFlight(f.status)).length,
  cruiseCount: t.cruises.filter((c) => isDoneCruise(c.status)).length,
  lodgingStayCount: doneStays(t),
}));
```

  3. `tripsFullyDocumented` uses the same computed counts (journal/photo
     `_count`s stay as they are — a written journal entry IS done).

- [ ] **Step 4: New tests PASS; run `achievements*` + `stats*` suites.**
- [ ] **Step 5: Commit** — `fix(achievements): a booking unlocks nothing`

---

### Task 4: Lodging `computeAggregates` learns the check-out rule

**Files:**
- Modify: `backend/src/routes/lodging.ts:112-127` (`computeAggregates`)
- Test: extend `backend/src/routes/__tests__/lodging.test.ts`

**Interfaces:**
- Consumes: `classifyStay` from `../shared/lodgingCounting` (add import;
  `AggregateStay` already carries `checkIn`, `checkOut`, and must carry
  `status` — extend the interface if missing).
- Produces: `LodgingAggregates` unchanged in SHAPE; `stayCount`, `nights`,
  `overallRating`, `totalSpendBase*` computed over VISITED stays only.
  `lodgingChains.ts` inherits automatically (verify, no change).

- [ ] **Step 1: Write the failing test** in the existing suite's style
  (it already creates lodgings + stays via the API): one lodging with a
  completed stay (past checkOut, 4 nights) and a scheduled stay (future
  dates, 3 nights). Assert the list row:

```ts
const list = await request(app).get('/api/v1/lodging').set('Cookie', cookie).expect(200);
const row = list.body.lodgings.find((l: { id: string }) => l.id === lodgingId);
expect(row.stayCount).toBe(1);
expect(row.nights).toBe(4);
```

- [ ] **Step 2: Run, watch FAIL** (stayCount 2, nights 7).
- [ ] **Step 3: Implement** — filter once at the top of `computeAggregates`:

```ts
export function computeAggregates(
  stays: AggregateStay[],
  currentBaseCurrency: string,
): LodgingAggregates {
  // The check-out rule (shared/lodgingCounting): a stay counts once it is
  // over. Future and cancelled bookings contribute nothing to any figure —
  // the same verdict the stats path (calculateLodgingStats) already applies.
  const visited = stays.filter((s) => classifyStay(s) === 'visited');
  const totalSpendBaseByCurrency = sumSpendBaseByCurrency(visited);
  return {
    overallRating: deriveOverallRating(visited),
    stayCount: visited.length,
    nights: visited.reduce((sum, s) => sum + resolveStayTiming(s).nights, 0),
    totalSpendBase: totalSpendBaseByCurrency[currentBaseCurrency] ?? 0,
    totalSpendBaseByCurrency,
  };
}
```

  If `AggregateStay` lacks `status`, add `status: string;` and confirm every
  caller passes it (the Prisma include pulls full stay rows).

- [ ] **Step 4: PASS + run `lodging*.test.ts` and `lodgingChains` suites.**
- [ ] **Step 5: Commit** — `fix(lodging): a future booking is not a stay in any aggregate`

---

### Task 5: Route aggregation carries flown vs. planned counts; airport "Letzter Besuch" stays in the past

**Files:**
- Modify: `frontend/src/components/layers/routesLayer.ts` (RouteRecord/`aggregateAllRoutes` `:62-120`, `buildArcs` `:165-189`, `buildAirportPoints` `:194-250`, ArcDatum type)
- Modify: `frontend/src/components/layers/flatRoutesLayer.ts` (`buildFlatRoutes` must thread the two new fields into its datum)
- Test: extend `frontend/src/__tests__/layers/routesLayer.test.ts`

**Interfaces:**
- Produces: `ArcDatum` (and the flat-route datum) gain
  `flownCount: number` (flights with status `flown`/`historical`) and
  `scheduledCount: number` (status `scheduled`). `count` keeps its meaning
  (all flights — width/frequency tiers unchanged). `PointDatum.lastVisit`
  is bumped only by non-`scheduled` flights. Task 6/7 consume these names
  EXACTLY.

- [ ] **Step 1: Write failing tests** (suite has builders for GeoJSON
  features — reuse them):

```ts
it('splits flown and scheduled counts per route', () => { /* 2 flown + 1 scheduled on one pair → arc.flownCount === 2, arc.scheduledCount === 1, arc.count === 3 */ });
it('a scheduled flight does not become the airport lastVisit', () => { /* flown 2024-05-01, scheduled 2027-01-01 → point.lastVisit starts with '2024' */ });
```

- [ ] **Step 2: Run, watch FAIL.**
- [ ] **Step 3: Implement** in `aggregateAllRoutes`:

```ts
const isFlown = f.properties.status === 'flown' || f.properties.status === 'historical';
// existing-record branch:
if (isScheduled) existing.scheduledCount += 1;
if (isFlown) existing.flownCount += 1;
// new-record branch:
flownCount: isFlown ? 1 : 0,
scheduledCount: isScheduled ? 1 : 0,
```

  Thread both through `buildArcs` into `ArcDatum`, and through
  `buildFlatRoutes`' datum. In `buildAirportPoints`, only call
  `bumpLastVisit` when `f.properties.status !== 'scheduled'` (count stays
  all-status — its label "Flüge" is neutral).

- [ ] **Step 4: PASS + full `routesLayer`/`flatRoutesLayer`/`flightRouteShape` suites.**
- [ ] **Step 5: Commit** — `fix(map): routes know flown from planned; a future flight is no last visit`

---

### Task 6: Arc tooltip says what is true; filter label goes neutral

**Files:**
- Modify: `frontend/src/components/map/markerTooltip.ts` (`ArcTooltipDatum` `:72-77`, `renderArcHtml` `:304-318`)
- Modify: `frontend/src/i18n/resources/de/map.json` + `en/map.json` (add `globe.timesPlanned`, change `filters.minFlown`)
- Test: extend `frontend/src/components/map/markerTooltip.test.ts`

**Interfaces:**
- Consumes: `flownCount`/`scheduledCount` from Task 5 (datum may still omit
  them — treat missing as legacy: fall back to the old `count` label).
- Produces: i18n keys `map:globe.timesPlanned` = DE `"{{count}}x geplant"` /
  EN `"Planned {{count}}x"`; `map:filters.minFlown` = DE
  `"Mindestens {{count}} Flüge"` / EN `"At least {{count}} flights"`.

- [ ] **Step 1: Failing tests** (suite mocks `t` — extend its mock for the
  new key, mirroring line 10):

```ts
it('labels a pure-scheduled route as planned, not flown', () => { /* datum {count:1, flownCount:0, scheduledCount:1} → html contains '1× geplant', NOT 'geflogen' */ });
it('labels a mixed route with both counts', () => { /* {count:4, flownCount:3, scheduledCount:1} → '3× geflogen' AND '1× geplant' */ });
it('keeps the plain flown label for legacy datums without counts', () => { /* {count:3} → '3× geflogen' */ });
```

- [ ] **Step 2: Run, watch FAIL.**
- [ ] **Step 3: Implement** in `renderArcHtml`:

```ts
const flown = d.flownCount;
const scheduled = d.scheduledCount;
let label: string;
if (typeof flown === 'number' && typeof scheduled === 'number') {
  const parts: string[] = [];
  if (flown > 0) parts.push(t('map:globe.timesFlown', { count: flown }));
  if (scheduled > 0) parts.push(t('map:globe.timesPlanned', { count: scheduled }));
  label = parts.join(' · ') || t('map:globe.timesFlown', { count: d.count ?? 0 });
} else {
  label = t('map:globe.timesFlown', { count: d.count ?? 0 });
}
```

  Extend `ArcTooltipDatum` with `readonly flownCount?: number; readonly scheduledCount?: number;`.
  Update both map.json files (DE first, EN mirrored in the same edit).

- [ ] **Step 4: PASS + whole markerTooltip suite + grep for other consumers of `filters.minFlown` (only Filters.tsx:340).**
- [ ] **Step 5: Commit** — `fix(map): the arc tooltip tells planned from flown`

---

### Task 7: Globe — honest arc label, past-only visits, sailed-only ports

**Files:**
- Modify: `frontend/src/components/GlobeView.tsx` (`airportPoints` `:870-931`, port aggregation `:1104-1158`, `onArcHover` `:1275-1296`; thread `flownCount`/`scheduledCount` into the globe's route aggregation `:796-835`)
- Modify: `frontend/src/components/Globe/cardStats.ts` (`getPortStats` `:106-147`)
- Modify: `frontend/src/components/layers/cruisePortsLayer.ts` (`:102` loop)
- Test: extend the existing suites next to each file (check for
  `cardStats.test.ts` / globe tests; where a pure function has no suite,
  create one — `cruisePortsLayer` aggregation and `cardStats` are pure and
  testable without WebGL).

**Interfaces:**
- Consumes: cruise done-predicate `c.status === 'flown' || c.status === 'historical'`;
  Task 6's i18n keys.
- Produces: none consumed later.

- [ ] **Step 1: Failing tests:**

```ts
it('cruise ports: a scheduled cruise contributes no visits', () => { /* createCruisePortsLayer([flownCruise, scheduledCruise]) → port of scheduledCruise absent; shared port visits === 1 */ });
it('cardStats: getPortStats ignores scheduled cruises', () => { /* totalVisits from flown only; lastCallDate not in the future */ });
```

  For `GlobeView` (component-heavy): the arc label change reuses Task 6's
  pattern; if no render test exists, cover the aggregation by extracting the
  filter predicate is NOT required — apply the same one-line filters and rely
  on the pure-function tests + `npx tsc --noEmit`.

- [ ] **Step 2: Run, watch FAIL.**
- [ ] **Step 3: Implement:**
  - `cruisePortsLayer.ts`: first line of the loop —
    `for (const cruise of cruises) { if (cruise.status !== 'flown' && cruise.status !== 'historical') continue; … }`
  - `GlobeView.tsx` ports (`:1106`): same guard in its `for (const c of cruises)`.
  - `GlobeView.tsx` airports: bump `lastVisit` only when the flight's status
    is not `scheduled` (size/count untouched — neutral label).
  - `GlobeView.tsx` routes: count `flownCount`/`scheduledCount` alongside the
    existing aggregation (same predicate as Task 5) and render `onArcHover`'s
    label with the Task 6 two-part logic (the datum already carries `status`;
    prefer the counts).
  - `cardStats.ts` `getPortStats`: filter the cruises before flat-mapping:
    `cruises.filter((c) => c.status === 'flown' || c.status === 'historical')`.

- [ ] **Step 4: PASS + `npx tsc --noEmit` + full vitest run.**
- [ ] **Step 5: Commit** — `fix(globe): visits and port calls come from sailed journeys`

---

### Task 8: Airport km, route sidebar, trip superlatives

**Files:**
- Modify: `frontend/src/components/AirportTooltip.tsx:44-73`
- Modify: `frontend/src/components/FlightPanel/RouteDetailsSidebar.tsx:17-96`
- Modify: `frontend/src/lib/stats/tripInsights.ts:73`
- Modify: `frontend/src/i18n/resources/de/dashboard.json` + `en/dashboard.json` (add `planned` sibling for the sidebar: DE `"geplant"`, EN `"planned"`, next to the existing top-level `"flown"` key `:152`)
- Test: extend `frontend/src/lib/stats/tripInsights.test.ts` (create if
  missing — pure function) and the AirportTooltip/RouteDetailsSidebar suites
  (create pure-logic tests or component render tests following the
  neighbouring test files' conventions).

**Interfaces:**
- Consumes: flight done-predicate; `TripStatus` (`"planned" | "in_progress" | "completed"`).

- [ ] **Step 1: Failing tests:**

```ts
it('airport km line sums flown flights only', () => { /* flown 1000km + scheduled 5000km → totalKm 1000 */ });
it('route sidebar separates flown and planned legs', () => { /* 2 flown + 1 scheduled → '2× geflogen' present, '1× geplant' present, never '3×' */ });
it('trip insights ignore planned trips', () => { /* planned trip with 20000km vs completed 3000km → longest = the completed one */ });
```

- [ ] **Step 2: Run, watch FAIL.**
- [ ] **Step 3: Implement:**
  - `AirportTooltip.tsx`: only add `f.properties.distance` when
    `f.properties.status === 'flown' || f.properties.status === 'historical'`
    (departures/arrivals/topRoutes stay all-status — neutral labels).
  - `RouteDetailsSidebar.tsx`:

```ts
const flownLegs = sorted.filter((f) => f.status === 'flown' || f.status === 'historical');
const scheduledLegs = sorted.filter((f) => f.status === 'scheduled');
```

    Render the counts line as the joined parts (`2× geflogen · 1× geplant`,
    either part omitted at zero; at both zero fall back to
    `${sorted.length}× ${t('dashboard:flown')}` to keep legacy behaviour for
    cancelled-only selections). Distance/Ø-duration keep their current inputs
    (labels are neutral "km"/"Ø").
  - `tripInsights.ts` first line of `computeTripInsights`:

```ts
const started = trips.filter((t) => t.status !== 'planned');
```

    …and use `started` for all three `winner()` calls.

- [ ] **Step 4: PASS + full frontend gate (`npx tsc --noEmit && npx vitest --run`).**
- [ ] **Step 5: Commit** — `fix(dashboard): flown claims count flown things; superlatives need a started trip`

---

## Final gate (after Task 8)

- [ ] Backend: `npx tsc --noEmit && npm run lint && npm test -- --forceExit`
- [ ] Frontend: `npx tsc --noEmit && npm run lint && npx vitest --run`
- [ ] Whole-branch review vs. the spec (every defect 1–13 has a fix + test;
      nothing under "Verified correct"/"Deferred" was touched).
