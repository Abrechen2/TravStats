# Cruise-Map-V2 — A* Sea-Routing Plan

**Date:** 2026-04-20
**Branch:** `dev/multi-domain-v1`
**Replaces:** `buildCruiseArc` Bezier-perpendicular-offset (known to cross continents)

## Goal

Replace the cosmetic cruise arcs with real sea-routes that stay on water.
Target accuracy: **~95 %** — close to reality for mainstream cruise
regions (Mediterranean, Caribbean, Transatlantic, Baltic, Alaska,
Southeast Asia). Edge cases (narrow Norwegian fjords, small Greek
islands, polar seasonal access) accepted as visually approximate.

Non-goals:
- Real-time vessel traffic data
- Currents, weather, fuel-optimal routing
- River cruises (separate data source, later phase)
- Ferry routing (separate domain, later)

## Architecture

```
                    ┌─────────────────────────────┐
                    │  Natural Earth 10m land     │
                    │  polygons (one-time DL)     │
                    └──────────────┬──────────────┘
                                   │ rasterize
                                   ▼
         ┌───────────────────────────────────────────────┐
         │  land-mask.bin  (binary, committed to repo)   │
         │  720 × 360 cells @ 0.5° ≈ 260 k bits ≈ 32 KB │
         └──────────────┬───────────────────────────────┘
                        │ loaded once at boot
                        ▼
   ┌─────────────────────────────────────────────────┐
   │  backend/src/services/seaRouter.ts              │
   │   · A* with 8-neighbour moves                   │
   │   · canal overrides (Suez, Panama, Kiel, …)     │
   │   · port-snap to nearest water cell             │
   │   · Douglas-Peucker simplification per zoom     │
   └──────────────┬──────────────────────────────────┘
                  │
                  ▼
      ┌─────────────────────────────────────┐
      │  cruise_route_cache table (new)     │
      │   (depPortId, arrPortId, geometry)  │
      │   written lazily on first compute   │
      └──────────────┬──────────────────────┘
                     │
                     ▼
     ┌─────────────────────────────────────────┐
     │  GET /api/v1/cruises/:id/geometry       │
     │   → FeatureCollection of sea-routes    │
     │     between consecutive stops           │
     └──────────────┬──────────────────────────┘
                    │
                    ▼
     ┌──────────────────────────────────────────┐
     │  frontend: cruiseArcsLayer              │
     │   · fetch /cruises/:id/geometry          │
     │   · render LineString                    │
     │   · fall back to Bezier if 404           │
     └──────────────────────────────────────────┘
```

## Tech choices — rationale

### Raster resolution: 0.5° (≈55 km per cell at equator)

Tradeoffs:
| Res | Cells | Bit-mask size | A* time (transatlantic) | Visual quality |
|---|---|---|---|---|
| 1.0° | 65k | 8 KB | ~10 ms | too coarse, loses Med |
| **0.5°** | **260k** | **32 KB** | **~50 ms** | **good enough** |
| 0.25° | 1 M | 128 KB | ~200 ms | great but slow |
| 0.1° | 6.5 M | 800 KB | ~1 s | overkill for first cut |

0.5° is the sweet spot for V2. If users complain about
Norwegian-coast detours we upgrade to 0.25°.

**Missing at 0.5°**: Kiel Canal, Corinth Canal, Bosporus mid-section,
Bab-el-Mandeb. Handled via explicit canal override cells (below).

### A* algorithm

- 8-neighbour moves (straight-line distance metric)
- Heuristic: haversine distance to target (admissible for sphere)
- Priority queue: simple binary heap, no fancy structure needed at 260k cells
- Tie-break: prefer moves that keep the path smoother (secondary cost)

### Canal overrides

Explicit list of cells that A* treats as water even though the raster
says land. Seeded manually from Wikipedia coordinates:

```ts
const CANAL_OVERRIDES = [
  // Suez Canal (30.6°N–31.2°N, 32.3°E)
  { cell: [120, 30.6], to: [120, 31.2] },
  // Panama Canal (9.1°N, -79.7°W)
  { cell: [9.1, -79.7], to: [9.3, -79.6] },
  // Kiel Canal (54.1°N, 9.1°E–10.1°E)
  { cell: [54.1, 9.1], to: [54.4, 10.1] },
  // Corinth Canal
  { cell: [37.9, 22.9], to: [37.9, 23.0] },
  // Strait of Bosporus (Marmara–Black)
  { cell: [40.9, 28.9], to: [41.4, 29.1] },
  // Bab-el-Mandeb
  { cell: [12.5, 43.3], to: [12.8, 43.4] },
];
```

### Port-snap

Ports rarely sit on a clean water cell (seed CSV uses city/terminal
coords). On A* start/end, search outward for the nearest water cell
up to 5° (≈550 km). If no water cell within 5° → route is impossible,
return 404 and frontend falls back to Bezier.

### Simplification: Douglas-Peucker

Raw A* output zigzags around coast. For display, simplify:
- World zoom (0–3): 50 km tolerance
- Continental (4–6): 20 km
- Regional (7–9): 5 km
- Port zoom (10+): no simplification

Cache ONE geometry per port-pair and simplify client-side per zoom,
OR cache multiple resolutions. Start with single raw + client-side
simplify; upgrade if cheap simplification turns out to be slow.

### Cache table

New Prisma model:

```prisma
model CruiseRouteCache {
  depPortId  Int
  arrPortId  Int
  // GeoJSON LineString [{lon, lat}, …], raw A* output pre-simplification
  geometry   Json
  computedAt DateTime @default(now())
  version    Int      @default(1)  // bump when we re-rasterize / change canals

  @@id([depPortId, arrPortId])
  @@map("cruise_route_cache")
}
```

- Primary key is the port-pair (unordered lookup via Math.min/max)
- Version field lets us invalidate cache when we upgrade raster or
  canals without a DB wipe
- `computedAt` for observability, not for expiry — ports + land don't move

## Phased implementation

### Phase 1 — Walking skeleton (1 day)

Minimum shippable:
- Raster generation script: `scripts/generate-land-mask.ts` reads
  Natural Earth CSV, outputs `backend/data/land-mask-0.5deg.bin`
- `seaRouter.ts` with A*, no canal overrides yet
- No cache table yet; compute on every request
- `/api/v1/cruises/:id/geometry` endpoint returns raw A* LineString
- Frontend: `cruiseArcsLayer` tries the endpoint, falls back to Bezier

Acceptance: Barcelona → Civitavecchia route stays in the Mediterranean
(doesn't cross Italy). Hamburg → New York stays in the Atlantic.

### Phase 2 — Canal overrides (0.5 day)

- Add the 6 canal overrides listed above
- Verify: a cruise from Hamburg → Rotterdam → Miami doesn't route
  around South America (Panama works); Istanbul → Odesa works
  (Bosporus); Saint-Petersburg → Hamburg works (no canal needed but
  checks Baltic + North Sea)

### Phase 3 — Caching (0.5 day)

- Add `CruiseRouteCache` Prisma model + migration
- `seaRouter.getOrCompute(a, b)` hits cache first, falls back to A*
- On cache-miss, compute + write back in same request (no queue yet)

### Phase 4 — Port-snap + error handling (0.5 day)

- Implement 5°-radius water-cell search
- Return 404 with reason if no water reachable (both ports landlocked,
  or user-added custom ports with wrong coords)
- Frontend handles 404: keep Bezier arc, log warning

### Phase 5 — Zoom-aware simplification (1 day)

- Douglas-Peucker util (pure TS, ~40 LOC)
- Frontend applies it based on `viewState.zoom`
- Tune tolerance table until Mediterranean cruise looks smooth at zoom 4

### Phase 6 — Observability + Tests (1 day)

- Unit tests: A* on a tiny 10×10 hand-crafted raster
- Integration test: known Mediterranean cruise → expect route between
  known waypoints (Gibraltar ∉ route, Strait of Messina ∈ route)
- Log: route length, cache hit/miss, compute time. Pino structured log.

### Phase 7 — Backfill (0.5 day)

- One-off script `scripts/backfill-cruise-routes.ts` warms the cache
  for all existing user cruises
- Run locally against dev DB, then against prod during next deploy

Total: **~5 working days** for all 7 phases.

## Risks

1. **Natural Earth 10m has coarse coastline**. Some straits may be
   closed in the raster at 0.5°. Mitigation: visual QA after Phase 1,
   add manual overrides as Phase 1.5 if more canal-scale issues
   emerge.

2. **A* on 260 k cells is fast but not free**. Cold cache = 50 ms
   per route, 8-stop cruise = 400 ms. Mitigation: cache (Phase 3)
   makes this a one-time cost per unique port pair across all users.

3. **Port coordinates are unreliable**. User-added ports in Phase F of
   the master-data admin may have wildly wrong lat/lon. Mitigation:
   port-snap with 5° radius + 404 fallback (Phase 4).

4. **Schema migration on prod**. The `cruise_route_cache` table adds
   to the schema-drift list. Mitigation: follow the pattern from
   `20260419140000_schema_drift_fix` — idempotent, guarded.

5. **Raster file size in repo**. 32 KB committed binary is fine.
   If we ever upgrade to 0.1° (800 KB) consider moving to an
   S3-backed download at boot.

## What stays out of scope for this plan

- **River routing** (Rhein, Donau, Mekong, etc.) — separate plan, uses
  OSM `waterway=river` centerlines instead of sea raster.
- **Ferry domain** — lives in a new `ferry` domain with its own plan;
  will share this `seaRouter` once built.
- **Real shipping-lane API** (`searoutes.com` etc.) — only if V2 proves
  insufficient after users try it for ~3 months.
- **Weather / currents / fuel-optimal routing** — out of scope for
  hobby travel-tracker.

## Decisions confirmed (2026-04-20)

1. **Raster resolution: 0.1°** (≈11 km per cell at equator). 3600×1800 =
   6.48 M cells, 810 KB committed binary. A* ≈1 s uncached, ≈0 ms on cache
   hit. Picked over 0.5° because Norwegian fjords, small Greek islands,
   and Chilean fjords are visibly wrong at 0.5°. 810 KB in the repo is
   fine in 2026.
2. **Canal list expanded to 15** overrides. Beyond the original 6:
   Panama Atlantic + Pacific as separate overrides, Kiel east + west
   entrances, Dardanelles (separate from Bosporus), Strait of Hormuz,
   Strait of Malacca, Sunda Strait, Great Belt, Öresund (Malmö–Copen-
   hagen), Cape Cod Canal. Covers all mainstream cruise regions.
3. **Cache: lazy invalidation** via version field. Next request after a
   raster/canal update recomputes and overwrites. No stampede risk
   because cruise-route demand is bounded (few cruises per user, one
   request per unique port-pair).
4. **UI during cache-miss**: render Bezier arc immediately as
   placeholder, swap to real route when `/cruises/:id/geometry`
   resolves. No spinner. Users with slow connections see an
   approximation instantly; the correct route paints in within ~1 s on
   first load, instantly thereafter.

## Code-quality requirements (explicit, no shortcuts)

User ask: "Keine Code-Abkürzungen, immer ordentlich." Concrete rules
for this plan:

- **Proper A***: binary heap for the open set (not a linear array),
  closed set as `Uint8Array` indexed by cell, haversine heuristic is
  pre-computed per row for speed.
- **Port-snap uses BFS** outward from the port cell, not naive radius
  scan (BFS guarantees nearest water cell).
- **Douglas-Peucker** as a reusable util in `shared/geo/` with its own
  unit tests, not inline.
- **Prisma migration via `npx prisma migrate dev`**, never hand-written
  (except the existing drift-fix migration, unrelated).
- **Canal overrides live in a dedicated `seaCanals.ts` module** with
  sourced comments (Wikipedia coords), not inline constants.
- **Pino structured logs** at INFO for cache-miss-compute, DEBUG for
  cache hits, WARN for port-snap-failure.
- **Unit tests per pure function** (`isWater`, `haversine`,
  `findNearestWater`, `computeSeaRoute` on 10×10 hand-crafted raster),
  integration test against a known Mediterranean cruise.
- **Backfill script** with progress reporter, resumable (skip cached
  pairs), dry-run flag.

## How this relates to other planned work

- Prod-DB-drift-audit (outstanding) must run BEFORE the
  `cruise_route_cache` migration. Unrelated schema changes still need
  to be reconciled first.
- Ferry domain (future) shares seaRouter — no work duplicated.
- Cruise E2E test suite (outstanding) should add a map-render
  assertion once routes are real.
