# Wave A — Stats Scorecard + Canonical Time-Series (Design)

**Date:** 2026-07-03
**Depends on:** `docs/superpowers/specs/2026-07-03-data-presentation-redesign-research.md`
(guidelines G1–G12, E1–E7; this design implements the "Wave A (foundation)" bullet)
**Surfaces:** Backend + Web now; App as a fast-follow (Wave A.2, same contract)

---

## 1. Goal & scope

Deliver the foundation the rest of the redesign stands on:

1. A **KPI scorecard** — 4–6 hero tiles, each = value + one-line takeaway +
   label-free sparkline + delta vs. the previous window (guidelines G1, G3, G4,
   G6, G7).
2. **Rolling time windows** driven by one segmented control (12-months rolling
   default | calendar year | all-time), replacing calendar-year-only
   granularity (G7, E3).
3. One **canonical time-series chart** that begins collapsing the current 4×
   redundancy (G5, G6). Full dedup and the second heatmap are **Wave C** — not
   here.
4. A shared backend **`/stats/timeseries`** endpoint so web and app stop
   re-deriving buckets divergently (single source of truth).

**Explicitly out of scope for Wave A** (later waves, do not build now):
drill-down / stat→filtered-list (Wave B), part-to-whole breakdown module and
redundancy removal / single heatmap (Wave C), records-as-hero-moments + share
cards + engagement loop (Wave D).

## 2. Decisions (resolved 2026-07-03)

- **D1 — New endpoint, yes.** `/stats/timeseries` is the source of truth for
  bucketed series + window totals. Reason: web and app currently compute
  monthly/yearly buckets independently (`AdvancedStatsPage.tsx` body vs.
  `TravStatsApp/src/lib/insights.ts`) and can drift; the guidelines call for
  "one canonical time-series view".
- **D2 — App stays offline-capable via the endpoint, not via local
  re-derivation.** The app consumes `/stats/timeseries` through its existing
  `offlineCache.readThrough` (fresh online, last value served offline). This
  keeps offline behavior *and* single-source-of-truth. The app already fetches
  the full flight list anyway, so this loses no offline capability in practice.
  (Alternative considered: keep pure-local aggregation in `insights.ts` — but
  that perpetuates the divergence D1 exists to kill.)
- **D3 — Backend + Web ship first; App is a fast-follow** (§7) on the same
  contract. Smaller blast radius per merge; the app plan builds on a verified
  endpoint.
- **D4 — Default window = rolling 12 months; sparkline = 12 monthly points;
  delta = current 12mo vs. the preceding 12mo.** Range control also offers
  calendar-year and all-time.
- **D5 — Domain-parameterized** per the CLAUDE.md domain-gating rule. The
  endpoint takes a `domain` param and implements `flight` + `cruise`
  (buckets cruises by cruise start date). No `includes('flight')`.

## 3. Backend

### 3.1 New endpoint

`GET /api/v1/stats/timeseries` (auth-gated, in `backend/src/routes/stats.ts`,
mounted with the rest of the stats router).

**Query (Zod `TimeseriesQuerySchema`):**
```ts
{
  domain: z.enum(["flight", "cruise"]).default("flight"),
  granularity: z.enum(["month", "year"]).default("month"),
  window: z.enum(["rolling12m", "year", "all"]).default("rolling12m"),
  year: z.coerce.number().int().min(1900).max(2100).optional(), // when window="year"
  // Explicit override (mutually exclusive with window); reuses existing pattern:
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
}
```

**Response:**
```ts
interface TimeseriesResponse {
  domain: "flight" | "cruise";
  granularity: "month" | "year";
  window: { from: string; to: string }; // resolved ISO bounds
  series: Array<{
    period: string;      // "YYYY-MM" or "YYYY"
    count: number;
    distanceKm: number;
    // flight-only extras allowed (durationMin); cruise-only (seaDays) — optional
  }>;
  current: { count: number; distanceKm: number };   // totals for the window
  previous: { count: number; distanceKm: number };  // same-length preceding window (for delta)
}
```

- The **previous** block is the same-length window immediately before
  `window.from` — this is what powers the scorecard delta (G7). For
  `rolling12m` it is the 12 months before the current 12; for `year` it is the
  prior calendar year; for `all` there is no previous (`previous = {0,0}`,
  delta hidden).
- Series buckets that have no data are emitted as zero rows so the sparkline is
  continuous (no gaps).

### 3.2 Service

New pure module `backend/src/utils/stats/timeseries.ts` (< 400 lines):
- `resolveWindow(window, year, fromDate, toDate, now)` → `{ from, to, prevFrom, prevTo }`.
  `now` is injected (testability; no `new Date()` inside pure logic).
- `bucketSeries(rows, granularity, from, to)` → zero-filled `series[]`.
- Flight rows come from `prisma.flight` filtered `status in ['flown','historical']`
  (matches existing geo/time endpoints); cruise rows from `prisma.cruise`
  `status != 'cancelled'` bucketed by start date.

The **route handler** builds the `where` (extends the existing `buildWhere`
helper to also return the previous-window bounds) and calls the service — same
"filter in the handler, aggregate in a pure fn" split the file already uses.

### 3.3 Tests (Jest, requires Postgres — follow `stats.airlines.test.ts`)

`backend/src/routes/stats.timeseries.test.ts`:
- rolling-12m bucketing: 13 flights across 13 months → 12 zero-filled monthly
  points, correct `current`/`previous` split at the boundary.
- calendar-year window + `year` param.
- `all` window → `previous = {0,0}`.
- `domain=cruise` buckets by start date.
- empty account → empty `series`, zero totals, 200 (not 500).
- boundary: a flight exactly on `from` is included, one just before is in
  `previous`.

## 4. Web

### 4.1 New components — `frontend/src/components/Stats/scorecard/`

- **`Sparkline.tsx`** — dependency-free inline-SVG primitive (no recharts per
  tile). Props: `{ points: number[]; filled?: boolean; className?: string }`.
  Normalizes to a `<polyline>` (+ optional filled area, per Few for magnitude
  context); **no gridlines, axes, or labels** (G6). Zero/one-point → flat line,
  no crash. Uses `--accent` stroke. This is the reusable preview primitive; the
  same normalization later feeds the expanded chart (G6 continuity).
- **`ScorecardTile.tsx`** — one hero tile: big value (`tabular-nums`), one-line
  takeaway string (G4), `<Sparkline>`, `<DeltaBadge>`. Reuses the
  `--bg-elevated`/`--color-border` surface. Value colored `--accent` to match
  the existing `StatCard`.
- **`KpiScorecard.tsx`** — the hero row: 4–6 `ScorecardTile`s. Wave-A KPI set
  (the "frequently needed" ones per G2): **total flights, total distance,
  flight time, distinct airports** (+ countries / cost when the cost feature is
  on). Trivia (CO₂ elephants etc.) stays in the existing sections below — not
  promoted into the hero.
- **`TimeRangeControl.tsx`** — segmented control: `12 Monate | Jahr | Gesamt`.
  Owns nothing; controlled, emits a resolved `{ window, year? }` up to the page.

### 4.2 Canonical time-series

- **`CanonicalTimeSeries.tsx`** — a single recharts chart (reuse the lib already
  in `StatsChartsSection.tsx`) fed by `/stats/timeseries`. Bar marks with
  **zero baseline** (G8), title carries the takeaway (G4). **Wave A removes the
  yearly + monthly charts from `StatsChartsSection` and replaces that pair with
  `CanonicalTimeSeries`** — a real, immediate redundancy reduction. The
  seasonal and weekday charts in `StatsChartsSection` stay. The *broader*
  redundancy (two heatmaps, airline-3×, year-KPIs-3×, cross-domain duplicates)
  is Wave C, not here.

### 4.3 DeltaBadge consolidation

Two implementations exist:
`frontend/src/components/Stats/DeltaBadge.tsx` (raw Tailwind `bg-green-100…`)
and `frontend/src/components/Stats/Overview/DeltaBadge.tsx` (brand tokens
`--success`/`--danger`). **Keep the token one**, move it to
`scorecard/DeltaBadge.tsx` (or a shared `Stats/DeltaBadge`), point both the
scorecard and `StatsYearFilter` at it, delete the raw-Tailwind version. Props
accept `{ current, previous }` and compute sign/pct internally.

### 4.4 API + types

- `frontend/src/lib/api/stats.ts`: add
  `getTimeseries(params): Promise<TimeseriesResponse>` → `GET /stats/timeseries`.
- `frontend/src/lib/api/types.ts`: add `TimeseriesParams` + `TimeseriesResponse`.
- The scorecard reads **both** `getTimeseries` (series + delta) and the existing
  `getSummary({ fromDate, toDate })` (scalar KPIs for the same window — the
  page already passes year today; extend it to pass the resolved window).

### 4.5 Page integration

`AdvancedStatsPage.tsx` flight tab: insert `<TimeRangeControl>` +
`<KpiScorecard>` + `<CanonicalTimeSeries>` at the top of the flight block
(above `StatsYearFilter`). The time-range state lives in the page and flows to
both new API calls. Everything below stays as-is for Wave A **except** the
yearly/monthly charts removed per §4.2. Note a deliberate temporary overlap:
`TimeRangeControl` (12M/Jahr/Gesamt) and the existing `StatsYearFilter`
(year + compare) both offer year selection during Wave A; unifying them into a
single control is Wave B/C IA cleanup, not Wave A. No routing changes.

### 4.6 Tests (Vitest, no DB)

`Sparkline.test.tsx` (normalization, empty/single/flat), `DeltaBadge.test.tsx`
(sign, pct, zero-previous hidden), `TimeRangeControl.test.tsx` (emits resolved
window), and a `KpiScorecard` render test with mocked API.

## 5. i18n (DE primary + EN mirror, same change)

New keys under a `stats:scorecard` namespace: range labels
(`12 Monate`/`Last 12 months`, `Jahr`/`Year`, `Gesamt`/`All-time`), delta
phrasing (`ggü. Vorzeitraum`/`vs. previous period`), and per-KPI takeaway
templates. Update `de` and `en` together.

## 6. Data flow (web)

```
TimeRangeControl ──(window)──▶ AdvancedStatsPage state
       AdvancedStatsPage ──getTimeseries({domain:'flight',window})──▶ /stats/timeseries
                          └─getSummary({fromDate,toDate})──────────▶ /stats/summary
       response.series ─▶ Sparkline (per tile) + CanonicalTimeSeries
       response.current/previous ─▶ DeltaBadge
       summary scalars ─▶ ScorecardTile values
```

## 7. App fast-follow (Wave A.2 — designed here, planned & built after web)

Same contract, no server changes. Files:
- `src/lib/api.ts`: add `getTimeseries(params)`; extend `getStatsSummary` to
  accept `{ fromDate?, toDate? }`. Both go through `offlineCache.readThrough`
  (D2 — offline-safe).
- `src/components/charts/Sparkline.tsx` (Skia or `react-native-svg` polyline;
  app already has Skia), `src/components/ui/ScorecardTile.tsx`,
  `TimeRangeControl` (RN segmented).
- `src/app/(tabs)/index.tsx` + `src/app/stats.tsx`: adopt the scorecard + range
  control. The scorecard series/delta come from the endpoint; `insights.ts`
  keeps its *other* derivations (nextFlight, onThisDay, etc.) but its
  `flightsPerYear`/`flightsPerMonth` are superseded by the endpoint series.
- `CountUpStat` (currently unused) can drive the tile value animation, or reuse
  `Odometer`.

## 8. Risks

- **Rolling-window boundary math** is the sharp edge — pin `now` injection and
  test the `current`/`previous` split explicitly (§3.3).
- **Prisma drift** (per CLAUDE.md): this endpoint is **read-only, no schema
  change / no migration**, so it sidesteps the known prod-drift blocker.
- **GitNexus impact:** run `gitnexus_impact` on `buildWhere` before extending
  it (it's shared by `/summary`).
- **Two DeltaBadges → one:** verify `StatsYearFilter` still renders after the
  swap.

## 9. Definition of done (Wave A)

Backend endpoint + tests green; web scorecard + range control + canonical chart
live on the flight tab reading real data; DeltaBadge consolidated; DE/EN keys
added; `tsc`/lint/vitest + backend jest all green. App fast-follow tracked as a
separate plan.
