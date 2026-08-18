# Status-blind counts — findings and the one rule (2026-08-18)

Trigger: on the 2.6.0-rc.5 UAT the owner hovered a purely scheduled route
(FRA–GRU, LH117 in 12 days) and the map tooltip said "1x geflogen". Three
systematic sweeps (flights, cruises, lodging/trips) confirmed the same class
of error across the app: **planned/scheduled items are counted or labelled as
completed.**

## The one rule

"Done" means done. The per-domain predicates already exist in the codebase —
every fix reuses them, none invents a new one:

| Domain | Done-predicate | Reference implementation |
|---|---|---|
| Flight | `status ∈ {'flown','historical'}` | `backend/src/routes/stats.ts:114` (`geoWhere`), `backend/src/utils/achievements.ts:63` |
| Cruise | `status ∈ {'flown','historical'}` | `backend/src/services/stats/travelAccount.ts:125-127` (excludes `cancelled` + `scheduled` + future end) |
| Lodging stay | `classifyStay(stay, now) === 'visited'` | `backend/src/shared/lodgingCounting.ts` (+ frontend mirror `frontend/src/shared/lodgingCounting.ts`) |
| Trip | `status !== 'planned'` (`TripStatus` in `frontend/src/types/index.ts:161`) | Trip card status pill |

`cancelled` handling beyond what these predicates already do (e.g. cancelled
cruises painted in the "gefahren" colour, cancelled flights counted as
`hasPastFlown` in the arc partition) is **deliberately out of scope** — it is
its own semantic question, recorded under Deferred.

## Confirmed defects (in scope)

### Backend

1. **`GET /stats/countries`** (`backend/src/routes/stats.ts:1185`) — the ONLY
   stats query without a status filter. A booked flight makes a country
   "visited" ("Länder besucht" KPI, CountryDistributionCard, per-year sets).
2. **`GET /stats/cruise`** (`backend/src/routes/stats.ts:1287-1288`) — filters
   only `{ status: { not: 'cancelled' } }`. Scheduled + in_progress cruises
   inflate EVERY "gefahren" figure out of `calculateCruiseStats`: cruisesCount,
   cruisePortsUnique, totalPortCalls, countries/countriesIso/countriesByYear,
   regions, seaDays, totalDistanceKm, totalCruiseDays, and the boolean flags
   (canal/polar/cold-water/birthday/new-years/dateline).
3. **Achievements** (`backend/src/utils/achievements.ts`):
   - Cruise input query (`:69-71`) uses `not: 'cancelled'` → all cruise
     achievements ("5 Kreuzfahrten abgeschlossen", "5 verschiedene Häfen
     besucht", "Mittelmeer besucht", …) unlock from a mere booking. The engine
     is monotonic — wrong unlocks persist. No cruise scheduled-leak regression
     test exists (the flight one does: `achievements.scheduledLeak.test.ts`).
   - Cruise-port country union (`:309-317`) feeds the countries/continents
     ladders from scheduled cruises.
   - Fly & Sail (`:285-287`) fires from a booked cruise+flight.
   - Trip `_count` (`:93-106`, consumed `:277-281` fly_and_stay/grand_tour and
     `:398-404` tripsFullyDocumented) counts scheduled flights/cruises and
     future lodging stays.
4. **`computeAggregates`** (`backend/src/routes/lodging.ts:112-127`) — no
   `classifyStay`, not even the cancelled exclusion. Feeds: map pin tooltip
   ("N Aufenthalte · M Übernachtungen"), LodgingListPage columns,
   LodgingDetailPage (incl. Ø-price/night = spend ÷ inflated nights),
   Dashboard "Aufenthalte pro Kette", and `lodgingChains.ts:112-113`.

### Frontend

5. **Route aggregation** (`frontend/src/components/layers/routesLayer.ts:85-120`)
   counts every status into `RouteRecord.count`; `buildAirportPoints`
   (`:194-250`) bumps `lastVisit` from scheduled flights → "Letzter Besuch"
   can be a FUTURE date.
6. **Arc tooltip** (`frontend/src/components/map/markerTooltip.ts:304-318`)
   renders `map:globe.timesFlown` ("{{count}}x geflogen") unconditionally —
   pure-scheduled routes say "1x geflogen", mixed routes say "4x geflogen"
   for 3 flown + 1 planned. Globe twin: `GlobeView.tsx:1275-1296` (the datum
   even carries `status` already).
7. **Globe airport/port aggregation** (`GlobeView.tsx:870-931` airports,
   `:1104-1158` ports) — same lastVisit/size defects; ports count stops of
   scheduled cruises as visits.
8. **Flat-map cruise ports** (`frontend/src/components/layers/cruisePortsLayer.ts:82-117`)
   — "N Besuche" + "Letzter Anlauf" from scheduled cruises; also inherited by
   `CruiseRouteMap.tsx:104` for a booked cruise's detail page.
9. **Globe pinned port card** (`frontend/src/components/Globe/cardStats.ts:106-147`)
   — totalVisits/lastCallDate/longestPortCallMinutes over all statuses.
10. **AirportTooltip** (`frontend/src/components/AirportTooltip.tsx:44-73`) —
    "X km geflogen" sums scheduled flights' distance.
11. **RouteDetailsSidebar** (`frontend/src/components/FlightPanel/RouteDetailsSidebar.tsx:95-96`)
    — "N× geflogen" counts scheduled legs.
12. **Filter label** `map:filters.minFlown` ("Mindestens {{count}}x geflogen",
    `de/map.json:9`) — the slider gates on the scheduled-inclusive count;
    wording must go neutral.
13. **Trip superlatives** (`frontend/src/lib/stats/tripInsights.ts:73-96`,
    `TripsPage.tsx:50`) — "Längste/Teuerste Reise", "Meiste Länder" can crown
    a `planned` trip.

## Verified correct (do NOT "fix")

- All other flight stats endpoints + Statistics page (filter at
  `AdvancedStatsPage.tsx:209`), flight achievements (planner metrics use the
  full set DELIBERATELY: `scheduledCount`, `scheduled30d`, …).
- The whole lodging stats path (`calculateLodgingStats`) incl. the 41 lodging
  achievements, `plannedStaysCount`/`plannedNights` reported separately.
- Travel account (`travelAccount.ts`) — the reference rule.
- Map colours/legends (probe-derived swatches), neutral counters ("Flüge",
  "Kreuzfahrten", "Unterkünfte" tab counts). NOTE: the "Unterkünfte" tab
  count is DELIBERATELY lower than the list rows (visited-only vs all) — do
  not "fix" that discrepancy in the wrong direction.
- `cruiseStatsAdapter.ts` mixed scope resolves itself once defect 2 filters
  the backend payload; only verify, no change.
- Trip cards' neutral "Länder" list + status pill (borderline, stays as-is).

## Deferred (recorded, not in this package)

- `cancelled` semantics on maps: cancelled cruises render in the "gefahren"
  colour (`cruiseColor.ts:146`, `cruiseArcsLayer.ts:115`); cancelled flights
  count as `hasPastFlown` in the arc partition (routesLayer comment says so).
- `buildStatsMapLayer` bubble sizing includes scheduled (no visible label —
  cosmetic).
- Lodging list/detail could show `plannedStayCount`/`plannedNights` siblings
  so a future-only hotel doesn't read "0 Aufenthalte" without explanation —
  needs an owner/product decision on presentation.
