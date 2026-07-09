# Wave A — Stats Scorecard + Canonical Time-Series Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the flight stats page a KPI hero scorecard (value + takeaway + sparkline + delta), a rolling/year/all time-range control, and one canonical time-series chart — all fed by a new shared `GET /stats/timeseries` endpoint.

**Architecture:** A new read-only backend endpoint returns zero-filled monthly/yearly series plus current-window and previous-window totals (count, distance, duration). Pure functions (`resolveWindow`, `bucketSeries`, `sumTotals`) do the window math and bucketing and are unit-tested without a DB; the route handler does the Prisma fetch + tz-aware duration (reusing existing helpers). The web side adds a dependency-free SVG `Sparkline`, a token-based `TrendDelta` pill (consolidating the stray raw-Tailwind DeltaBadge), presentational `ScorecardTile`/`KpiScorecard`, a segmented `TimeRangeControl`, and a `CanonicalTimeSeries` recharts chart that replaces the redundant yearly+monthly charts.

**Tech Stack:** Backend — Express + Zod + Prisma + Jest/supertest. Frontend — React + Vite + TypeScript + recharts + Vitest + Testing Library + react-i18next.

## Global Constraints

- **Scope is flights + the flight tab only** for the web hero; the App is a separate later plan (Wave A.2). The endpoint is domain-parameterized (`domain=flight|cruise`) and implements both, but the web UI wires flights only.
- **Read-only. No Prisma schema change, no migration** (sidesteps the known prod-drift blocker per CLAUDE.md).
- **`any` is FORBIDDEN** — use `unknown` + type guards (CLAUDE.md).
- **No `console.log`** — backend uses `import logger from '../utils/logger'`; frontend uses `import { logger } from "../lib/logger"`.
- **i18n DE + EN together** — every new user-facing string added to `de/stats.json` and `en/stats.json` in the same task. DE is primary.
- **Immutability** — spread, never mutate.
- **Conventional commits, no attribution trailer** (repo convention; global setting disables attribution).
- **File size** 200–400 lines ideal, 800 hard max.
- **Hero KPI set for Wave A = 3 tiles (Flights, Distance, Flight time)** — each consistent (value + takeaway + sparkline + delta). Distinct airports / countries / cost are deferred to a later wave so the endpoint stays lightweight and every hero tile is uniform. (Refines the spec's "4–6" down to a coherent 3 for Wave A.)
- **All UTC** — window math uses `Date.UTC` / `getUTC*` exclusively (matches `buildWhere` in `stats.ts`).
- **Verify commands before "done":**
  - Backend: `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`
  - Frontend: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`

---

## File Structure

**Backend**
- Create `backend/src/utils/stats/timeseries.ts` — pure window/bucketing logic (types + `resolveWindow`, `bucketSeries`, `sumTotals`).
- Create `backend/src/utils/stats/timeseries.test.ts` — unit tests for the pure functions (no DB).
- Modify `backend/src/routes/stats.ts` — add `TimeseriesQuerySchema` + `GET /timeseries` handler.
- Create `backend/src/routes/stats.timeseries.test.ts` — route integration test (mocked prisma + airportCache).

**Frontend**
- Create `frontend/src/components/Stats/scorecard/Sparkline.tsx` (+ `Sparkline.test.tsx`)
- Create `frontend/src/components/Stats/TrendDelta.tsx` (+ `TrendDelta.test.tsx`); modify `StatsYearFilter.tsx`; delete `frontend/src/components/Stats/DeltaBadge.tsx`
- Modify `frontend/src/lib/api/types.ts` (add timeseries types); modify `frontend/src/lib/api/stats.ts` (add `getTimeseries`)
- Create `frontend/src/components/Stats/scorecard/ScorecardTile.tsx` + `KpiScorecard.tsx` (+ tests)
- Create `frontend/src/components/Stats/scorecard/TimeRangeControl.tsx` (+ test)
- Create `frontend/src/components/Stats/scorecard/CanonicalTimeSeries.tsx` (+ test)
- Modify `frontend/src/components/Stats/StatsChartsSection.tsx` (drop yearly + monthly blocks/props)
- Modify `frontend/src/pages/AdvancedStatsPage.tsx` (wire the new components; drop now-unused yearly/monthly computation)
- Modify `frontend/src/i18n/resources/de/stats.json` + `en/stats.json`

---

## Task 1: Backend — pure window resolver

**Files:**
- Create: `backend/src/utils/stats/timeseries.ts`
- Test: `backend/src/utils/stats/timeseries.test.ts`

**Interfaces:**
- Produces:
  - `type Granularity = "month" | "year"`
  - `type WindowKind = "rolling12m" | "year" | "all"`
  - `interface ResolvedWindow { from: Date; to: Date; prevFrom: Date | null; prevTo: Date | null }`
  - `resolveWindow(window: WindowKind, year: number | undefined, fromDate: string | undefined, toDate: string | undefined, now: Date): ResolvedWindow`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/utils/stats/timeseries.test.ts
import { describe, it, expect } from "@jest/globals";
import { resolveWindow } from "./timeseries";

const NOW = new Date(Date.UTC(2026, 6, 15)); // 2026-07-15

describe("resolveWindow", () => {
  it("rolling12m spans the 12 months ending with the current month", () => {
    const w = resolveWindow("rolling12m", undefined, undefined, undefined, NOW);
    // 'to' is the exclusive start-of-next-month; 'from' is 12 months before it
    expect(w.to.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(w.from.toISOString()).toBe("2025-08-01T00:00:00.000Z");
    expect(w.prevTo!.toISOString()).toBe("2025-08-01T00:00:00.000Z");
    expect(w.prevFrom!.toISOString()).toBe("2024-08-01T00:00:00.000Z");
  });

  it("year window covers the calendar year and previous year", () => {
    const w = resolveWindow("year", 2024, undefined, undefined, NOW);
    expect(w.from.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(w.prevFrom!.toISOString()).toBe("2023-01-01T00:00:00.000Z");
    expect(w.prevTo!.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("all window has no previous window", () => {
    const w = resolveWindow("all", undefined, undefined, undefined, NOW);
    expect(w.from.getTime()).toBe(0);
    expect(w.to.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(w.prevFrom).toBeNull();
    expect(w.prevTo).toBeNull();
  });

  it("explicit fromDate/toDate override the window and have no previous", () => {
    const w = resolveWindow("rolling12m", undefined, "2023-03-01", "2023-06-01", NOW);
    expect(w.from.toISOString()).toBe("2023-03-01T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2023-06-01T00:00:00.000Z");
    expect(w.prevFrom).toBeNull();
    expect(w.prevTo).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/utils/stats/timeseries.test.ts -t resolveWindow`
Expected: FAIL — `Cannot find module './timeseries'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/utils/stats/timeseries.ts
export type Granularity = "month" | "year";
export type WindowKind = "rolling12m" | "year" | "all";

export interface ResolvedWindow {
  from: Date;
  to: Date;
  prevFrom: Date | null;
  prevTo: Date | null;
}

/** First day (UTC) of the month `offset` months away from `d`. */
function startOfMonthUTC(d: Date, offset = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
}

/**
 * Resolve the current + previous window bounds. `now` is injected so the
 * logic is pure and testable. Explicit fromDate/toDate take precedence and
 * yield no previous window (an arbitrary range has no natural predecessor).
 */
export function resolveWindow(
  window: WindowKind,
  year: number | undefined,
  fromDate: string | undefined,
  toDate: string | undefined,
  now: Date,
): ResolvedWindow {
  if (fromDate || toDate) {
    return {
      from: fromDate ? new Date(fromDate) : new Date(0),
      to: toDate ? new Date(toDate) : startOfMonthUTC(now, 1),
      prevFrom: null,
      prevTo: null,
    };
  }

  if (window === "year") {
    const y = year ?? now.getUTCFullYear();
    return {
      from: new Date(Date.UTC(y, 0, 1)),
      to: new Date(Date.UTC(y + 1, 0, 1)),
      prevFrom: new Date(Date.UTC(y - 1, 0, 1)),
      prevTo: new Date(Date.UTC(y, 0, 1)),
    };
  }

  if (window === "all") {
    return {
      from: new Date(0),
      to: startOfMonthUTC(now, 1),
      prevFrom: null,
      prevTo: null,
    };
  }

  // rolling12m — 12 whole months ending with the current month
  const to = startOfMonthUTC(now, 1);
  const from = startOfMonthUTC(now, -11);
  const prevFrom = startOfMonthUTC(now, -23);
  return { from, to, prevFrom, prevTo: from };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/utils/stats/timeseries.test.ts -t resolveWindow`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/stats/timeseries.ts backend/src/utils/stats/timeseries.test.ts
git commit -m "feat(stats): add pure timeseries window resolver"
```

---

## Task 2: Backend — pure bucketing + totals

**Files:**
- Modify: `backend/src/utils/stats/timeseries.ts`
- Test: `backend/src/utils/stats/timeseries.test.ts`

**Interfaces:**
- Consumes: `Granularity` (Task 1)
- Produces:
  - `interface DatedRow { date: Date; distanceKm: number; durationMin: number }`
  - `interface TimeseriesPoint { period: string; count: number; distanceKm: number; durationMin: number }`
  - `interface WindowTotals { count: number; distanceKm: number; durationMin: number }`
  - `bucketSeries(rows: DatedRow[], granularity: Granularity, from: Date, to: Date): TimeseriesPoint[]`
  - `sumTotals(rows: DatedRow[]): WindowTotals`

- [ ] **Step 1: Write the failing test**

```ts
// append to backend/src/utils/stats/timeseries.test.ts
import { bucketSeries, sumTotals, type DatedRow } from "./timeseries";

const row = (iso: string, km: number, min: number): DatedRow => ({
  date: new Date(iso),
  distanceKm: km,
  durationMin: min,
});

describe("bucketSeries", () => {
  it("zero-fills every month in the window and slots rows by month", () => {
    const from = new Date(Date.UTC(2025, 0, 1));
    const to = new Date(Date.UTC(2025, 3, 1)); // Jan, Feb, Mar
    const rows = [row("2025-01-10", 100, 60), row("2025-01-20", 50, 30), row("2025-03-05", 200, 120)];
    const series = bucketSeries(rows, "month", from, to);
    expect(series.map((p) => p.period)).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(series[0]).toEqual({ period: "2025-01", count: 2, distanceKm: 150, durationMin: 90 });
    expect(series[1]).toEqual({ period: "2025-02", count: 0, distanceKm: 0, durationMin: 0 });
    expect(series[2]).toEqual({ period: "2025-03", count: 1, distanceKm: 200, durationMin: 120 });
  });

  it("buckets by year when granularity is year", () => {
    const from = new Date(Date.UTC(2022, 0, 1));
    const to = new Date(Date.UTC(2025, 0, 1)); // 2022, 2023, 2024
    const rows = [row("2022-05-01", 10, 5), row("2024-11-01", 20, 8)];
    const series = bucketSeries(rows, "year", from, to);
    expect(series.map((p) => p.period)).toEqual(["2022", "2023", "2024"]);
    expect(series[0].count).toBe(1);
    expect(series[1].count).toBe(0);
    expect(series[2].count).toBe(1);
  });

  it("excludes rows on the exclusive upper bound", () => {
    const from = new Date(Date.UTC(2025, 0, 1));
    const to = new Date(Date.UTC(2025, 1, 1));
    const series = bucketSeries([row("2025-02-01", 1, 1)], "month", from, to);
    expect(series).toEqual([{ period: "2025-01", count: 0, distanceKm: 0, durationMin: 0 }]);
  });
});

describe("sumTotals", () => {
  it("sums count, distance and duration", () => {
    expect(sumTotals([row("2025-01-01", 100, 60), row("2025-02-01", 50, 30)])).toEqual({
      count: 2,
      distanceKm: 150,
      durationMin: 90,
    });
  });
  it("returns zeros for an empty list", () => {
    expect(sumTotals([])).toEqual({ count: 0, distanceKm: 0, durationMin: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/utils/stats/timeseries.test.ts -t bucketSeries`
Expected: FAIL — `bucketSeries is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to backend/src/utils/stats/timeseries.ts
export interface DatedRow {
  date: Date;
  distanceKm: number;
  durationMin: number;
}

export interface TimeseriesPoint {
  period: string;
  count: number;
  distanceKm: number;
  durationMin: number;
}

export interface WindowTotals {
  count: number;
  distanceKm: number;
  durationMin: number;
}

function periodKey(d: Date, g: Granularity): string {
  const y = d.getUTCFullYear();
  if (g === "year") return String(y);
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Ordered list of bucket-start Dates covering [from, to). */
function bucketStarts(from: Date, to: Date, g: Granularity): Date[] {
  const out: Date[] = [];
  let cur =
    g === "year"
      ? new Date(Date.UTC(from.getUTCFullYear(), 0, 1))
      : new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cur.getTime() < to.getTime()) {
    out.push(cur);
    cur =
      g === "year"
        ? new Date(Date.UTC(cur.getUTCFullYear() + 1, 0, 1))
        : new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return out;
}

export function bucketSeries(
  rows: DatedRow[],
  granularity: Granularity,
  from: Date,
  to: Date,
): TimeseriesPoint[] {
  const buckets = new Map<string, TimeseriesPoint>();
  for (const start of bucketStarts(from, to, granularity)) {
    const key = periodKey(start, granularity);
    buckets.set(key, { period: key, count: 0, distanceKm: 0, durationMin: 0 });
  }
  for (const r of rows) {
    if (r.date.getTime() < from.getTime() || r.date.getTime() >= to.getTime()) continue;
    const point = buckets.get(periodKey(r.date, granularity));
    if (!point) continue;
    point.count += 1;
    point.distanceKm += r.distanceKm;
    point.durationMin += r.durationMin;
  }
  return Array.from(buckets.values());
}

export function sumTotals(rows: DatedRow[]): WindowTotals {
  return rows.reduce<WindowTotals>(
    (acc, r) => ({
      count: acc.count + 1,
      distanceKm: acc.distanceKm + r.distanceKm,
      durationMin: acc.durationMin + r.durationMin,
    }),
    { count: 0, distanceKm: 0, durationMin: 0 },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/utils/stats/timeseries.test.ts`
Expected: PASS (all resolveWindow + bucketSeries + sumTotals tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/stats/timeseries.ts backend/src/utils/stats/timeseries.test.ts
git commit -m "feat(stats): add pure timeseries bucketing and totals"
```

---

## Task 3: Backend — `GET /stats/timeseries` route

**Files:**
- Modify: `backend/src/routes/stats.ts` (add schema near line 41; add handler after the `/summary` handler ~line 251)
- Test: `backend/src/routes/stats.timeseries.test.ts`

**Interfaces:**
- Consumes: `resolveWindow`, `bucketSeries`, `sumTotals`, `DatedRow`, `WindowKind`, `Granularity`, `TimeseriesPoint`, `WindowTotals` (Tasks 1–2); existing `calculateDistance`, `getCachedAirports`, `tzAwareDurationMinutes`, `FlightTimeSemantics`, `prisma`, `logger`.
- Produces (HTTP response shape, mirrored on the web in Task 6):
  ```ts
  interface TimeseriesResponse {
    domain: "flight" | "cruise";
    granularity: "month" | "year";
    window: { from: string; to: string };
    series: TimeseriesPoint[];
    current: WindowTotals;
    previous: WindowTotals;
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/stats.timeseries.test.ts
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFlightFindMany = jest.fn();
const mockCruiseFindMany = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    flight: { findMany: mockFlightFindMany },
    cruise: { findMany: mockCruiseFindMany },
  },
}));
jest.mock("../middleware/auth", () => ({
  authenticate: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = "u1";
    next();
  },
  AuthRequest: {},
}));
jest.mock("../services/airportCache", () => ({
  getCachedAirports: jest.fn(async () => new Map()),
}));

import request from "supertest";
import express from "express";

describe("GET /api/v1/stats/timeseries", () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    mockFlightFindMany.mockReset();
    mockCruiseFindMany.mockReset();
    const { default: statsRoutes } = await import("./stats");
    app = express();
    app.use(express.json());
    app.use("/api/v1/stats", statsRoutes);
  });

  it("returns a zero-filled flight series with current and previous totals", async () => {
    // current window rows on first call, previous window rows on second call
    mockFlightFindMany
      .mockResolvedValueOnce([
        {
          depIata: "FRA", depIcao: null, depLat: 50, depLon: 8,
          arrIata: "JFK", arrIcao: null, arrLat: 40, arrLon: -73,
          departureTime: new Date("2025-03-10T00:00:00Z"), arrivalTime: null,
          depTimeSemantics: "LOCAL", arrTimeSemantics: "LOCAL",
        },
      ])
      .mockResolvedValueOnce([]); // previous window empty

    const res = await request(app).get(
      "/api/v1/stats/timeseries?domain=flight&granularity=month&fromDate=2025-01-01&toDate=2025-04-01",
    );

    expect(res.status).toBe(200);
    expect(res.body.domain).toBe("flight");
    expect(res.body.series.map((p: { period: string }) => p.period)).toEqual([
      "2025-01", "2025-02", "2025-03",
    ]);
    const march = res.body.series.find((p: { period: string }) => p.period === "2025-03");
    expect(march.count).toBe(1);
    expect(march.distanceKm).toBeGreaterThan(0);
    expect(res.body.current.count).toBe(1);
    expect(res.body.previous.count).toBe(0);
  });

  it("returns 200 with an empty series for an account with no flights", async () => {
    mockFlightFindMany.mockResolvedValue([]);
    const res = await request(app).get("/api/v1/stats/timeseries?window=year&year=2020");
    expect(res.status).toBe(200);
    expect(res.body.current).toEqual({ count: 0, distanceKm: 0, durationMin: 0 });
  });

  it("buckets cruises by start date when domain=cruise", async () => {
    mockCruiseFindMany
      .mockResolvedValueOnce([
        { startDate: new Date("2025-02-01T00:00:00Z"), legs: [{ distanceKm: 300 }, { distanceKm: 200 }] },
      ])
      .mockResolvedValueOnce([]);
    const res = await request(app).get(
      "/api/v1/stats/timeseries?domain=cruise&granularity=month&fromDate=2025-01-01&toDate=2025-03-01",
    );
    expect(res.status).toBe(200);
    const feb = res.body.series.find((p: { period: string }) => p.period === "2025-02");
    expect(feb.count).toBe(1);
    expect(feb.distanceKm).toBe(500);
  });

  it("rejects an invalid domain", async () => {
    const res = await request(app).get("/api/v1/stats/timeseries?domain=hotel");
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/routes/stats.timeseries.test.ts`
Expected: FAIL — 404 (route not defined) so assertions on body fail.

- [ ] **Step 3a: Add the schema** — in `backend/src/routes/stats.ts`, immediately after `SummaryQuerySchema` (ends line 41):

```ts
// Timeseries endpoint — bucketed series + current/previous window totals
const TimeseriesQuerySchema = z.object({
  domain: z.enum(["flight", "cruise"]).default("flight"),
  granularity: z.enum(["month", "year"]).default("month"),
  window: z.enum(["rolling12m", "year", "all"]).default("rolling12m"),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});
```

- [ ] **Step 3b: Add the import** — extend the existing timezone import block (line 18 area) and add the timeseries util import after line 19:

```ts
import {
  resolveWindow,
  bucketSeries,
  sumTotals,
  type DatedRow,
} from '../utils/stats/timeseries';
```

- [ ] **Step 3c: Add the handler** — after the `/summary` handler closes (line 251), insert:

```ts
// Build a UTC-timezone map for a set of flight rows (mirrors computeSummary).
async function buildTzMap(
  rows: Array<{ depIata: string | null; depIcao: string | null; arrIata: string | null; arrIcao: string | null }>,
): Promise<Map<string, string>> {
  const codes = new Set<string>();
  for (const f of rows) {
    if (f.depIata) codes.add(f.depIata);
    if (f.depIcao) codes.add(f.depIcao);
    if (f.arrIata) codes.add(f.arrIata);
    if (f.arrIcao) codes.add(f.arrIcao);
  }
  const map = new Map<string, string>();
  try {
    const airports = await getCachedAirports(Array.from(codes));
    for (const [code, data] of airports.entries()) {
      if (data?.timezone) map.set(code, data.timezone);
    }
  } catch {
    // timezone lookup failed — durations fall back to naïve diff
  }
  return map;
}

async function fetchFlightDatedRows(
  userId: string,
  from: Date,
  to: Date,
): Promise<DatedRow[]> {
  const rows = await prisma.flight.findMany({
    where: {
      userId,
      status: { in: ['flown', 'historical'] },
      departureTime: { gte: from, lt: to },
    },
    select: {
      depIata: true, depIcao: true, depLat: true, depLon: true,
      arrIata: true, arrIcao: true, arrLat: true, arrLon: true,
      departureTime: true, arrivalTime: true,
      depTimeSemantics: true, arrTimeSemantics: true,
    },
  });
  const tzMap = await buildTzMap(rows);
  return rows.map((f) => {
    const depTz = (f.depIata && tzMap.get(f.depIata)) || (f.depIcao && tzMap.get(f.depIcao)) || null;
    const arrTz = (f.arrIata && tzMap.get(f.arrIata)) || (f.arrIcao && tzMap.get(f.arrIcao)) || null;
    const durationMin =
      f.departureTime && f.arrivalTime
        ? tzAwareDurationMinutes(
            f.departureTime, f.arrivalTime, depTz, arrTz,
            f.depTimeSemantics as FlightTimeSemantics,
            f.arrTimeSemantics as FlightTimeSemantics,
          ) ?? 0
        : 0;
    return {
      date: f.departureTime as Date,
      distanceKm: calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon),
      durationMin,
    };
  });
}

async function fetchCruiseDatedRows(
  userId: string,
  from: Date,
  to: Date,
): Promise<DatedRow[]> {
  const rows = await prisma.cruise.findMany({
    where: { userId, status: { not: 'cancelled' }, startDate: { gte: from, lt: to } },
    select: { startDate: true, legs: { select: { distanceKm: true } } },
  });
  return rows.map((c) => ({
    date: c.startDate as Date,
    distanceKm: c.legs.reduce((sum, l) => sum + (l.distanceKm ?? 0), 0),
    durationMin: 0,
  }));
}

router.get('/timeseries', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const parsed = TimeseriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
      return;
    }
    const { domain, granularity, window, year, fromDate, toDate } = parsed.data;
    const w = resolveWindow(window, year, fromDate, toDate, new Date());

    const fetchRows = domain === 'cruise' ? fetchCruiseDatedRows : fetchFlightDatedRows;
    const [currentRows, previousRows] = await Promise.all([
      fetchRows(userId, w.from, w.to),
      w.prevFrom && w.prevTo ? fetchRows(userId, w.prevFrom, w.prevTo) : Promise.resolve([] as DatedRow[]),
    ]);

    res.json({
      domain,
      granularity,
      window: { from: w.from.toISOString(), to: w.to.toISOString() },
      series: bucketSeries(currentRows, granularity, w.from, w.to),
      current: sumTotals(currentRows),
      previous: sumTotals(previousRows),
    });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/routes/stats.timeseries.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify types + lint, then commit**

Run: `cd backend && npx tsc --noEmit && npm run lint`
Expected: no errors.

```bash
git add backend/src/routes/stats.ts backend/src/routes/stats.timeseries.test.ts
git commit -m "feat(stats): add GET /stats/timeseries endpoint (flight + cruise)"
```

---

## Task 4: Web — `Sparkline` SVG primitive

**Files:**
- Create: `frontend/src/components/Stats/scorecard/Sparkline.tsx`
- Test: `frontend/src/components/Stats/scorecard/Sparkline.test.tsx`

**Interfaces:**
- Produces: `interface SparklineProps { points: number[]; filled?: boolean; height?: number; strokeWidth?: number; className?: string }` — default export `Sparkline`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/Stats/scorecard/Sparkline.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Sparkline from "./Sparkline";

describe("Sparkline", () => {
  it("renders a polyline for >=2 points", () => {
    const { container } = render(<Sparkline points={[1, 4, 2, 8]} />);
    const poly = container.querySelector("polyline");
    expect(poly).not.toBeNull();
    // 4 points → 4 coordinate pairs
    expect(poly!.getAttribute("points")!.trim().split(/\s+/)).toHaveLength(4);
  });

  it("renders nothing (no svg) for an empty series", () => {
    const { container } = render(<Sparkline points={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("does not crash on a flat series and still draws a line", () => {
    const { container } = render(<Sparkline points={[5, 5, 5]} />);
    expect(container.querySelector("polyline")).not.toBeNull();
  });

  it("renders a filled area polygon when filled", () => {
    const { container } = render(<Sparkline points={[1, 2, 3]} filled />);
    expect(container.querySelector("polygon")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Stats/scorecard/Sparkline.test.tsx`
Expected: FAIL — cannot resolve `./Sparkline`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/Stats/scorecard/Sparkline.tsx
import type { JSX } from "react";

interface SparklineProps {
  points: number[];
  filled?: boolean;
  height?: number;
  strokeWidth?: number;
  className?: string;
}

// Dependency-free trend preview per HIG "sneak peek" charts: no axes, grid or
// labels — only the data's shape. Uses a fixed 100-wide viewBox scaled to width.
export default function Sparkline({
  points,
  filled = false,
  height = 28,
  strokeWidth = 1.5,
  className,
}: SparklineProps): JSX.Element | null {
  if (points.length === 0) return null;

  const W = 100;
  const H = height;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1; // flat series → straight mid line
  const n = points.length;

  const coords = points.map((v, i) => {
    const x = n === 1 ? W / 2 : (i / (n - 1)) * W;
    const y = H - ((v - min) / span) * H;
    return [Number(x.toFixed(2)), Number(y.toFixed(2))] as const;
  });

  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${coords[0][0]},${H} ${line} ${coords[coords.length - 1][0]},${H}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height={H}
      className={className}
      aria-hidden="true"
      style={{ display: "block", overflow: "visible" }}
    >
      {filled && <polygon points={area} fill="var(--accent-soft, rgba(240,169,71,0.18))" stroke="none" />}
      <polyline
        points={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/Stats/scorecard/Sparkline.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Stats/scorecard/Sparkline.tsx frontend/src/components/Stats/scorecard/Sparkline.test.tsx
git commit -m "feat(stats): add dependency-free Sparkline primitive"
```

---

## Task 5: Web — `TrendDelta` pill + DeltaBadge consolidation

**Files:**
- Create: `frontend/src/components/Stats/TrendDelta.tsx`
- Test: `frontend/src/components/Stats/TrendDelta.test.tsx`
- Modify: `frontend/src/components/Stats/StatsYearFilter.tsx`
- Delete: `frontend/src/components/Stats/DeltaBadge.tsx`

**Interfaces:**
- Produces: `interface TrendDeltaProps { current: number; previous: number; compareLabel?: string }` — default export `TrendDelta`. Token-based pill (`--success`/`--danger`/`--text-muted`), hides percent when `previous <= 0`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/Stats/TrendDelta.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TrendDelta from "./TrendDelta";

describe("TrendDelta", () => {
  it("shows an up arrow and positive percent when current > previous", () => {
    render(<TrendDelta current={120} previous={100} />);
    expect(screen.getByText(/↑/)).toBeInTheDocument();
    expect(screen.getByText(/\+20%/)).toBeInTheDocument();
  });

  it("shows a down arrow when current < previous", () => {
    render(<TrendDelta current={80} previous={100} />);
    expect(screen.getByText(/↓/)).toBeInTheDocument();
  });

  it("omits percent when previous is zero", () => {
    render(<TrendDelta current={5} previous={0} />);
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("renders the compare label when provided", () => {
    render(<TrendDelta current={2} previous={1} compareLabel="ggü. Vorzeitraum" />);
    expect(screen.getByText(/ggü\. Vorzeitraum/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Stats/TrendDelta.test.tsx`
Expected: FAIL — cannot resolve `./TrendDelta`.

- [ ] **Step 3a: Write the component**

```tsx
// frontend/src/components/Stats/TrendDelta.tsx
import type { JSX } from "react";

interface TrendDeltaProps {
  current: number;
  previous: number;
  compareLabel?: string;
}

// Token-based delta pill. Supersedes the raw-Tailwind DeltaBadge; the Overview
// tab keeps its own DeltaInfo-based badge. Percent is hidden when previous<=0
// (no meaningful ratio), matching the aggregate.delta() convention.
export default function TrendDelta({ current, previous, compareLabel }: TrendDeltaProps): JSX.Element {
  const diff = current - previous;
  const pct = previous > 0 ? Math.round((diff / previous) * 100) : null;
  const sign = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const arrow = sign === "up" ? "↑" : sign === "down" ? "↓" : "→";
  const signStr = diff > 0 ? "+" : "";
  const bg =
    sign === "up" ? "rgba(63, 185, 80, 0.18)" : sign === "down" ? "rgba(248, 81, 73, 0.18)" : "var(--bg-elevated)";
  const fg = sign === "up" ? "var(--success)" : sign === "down" ? "var(--danger)" : "var(--text-muted)";

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold font-mono"
      style={{ background: bg, color: fg }}
    >
      {arrow} {signStr}
      {diff}
      {pct !== null && (
        <span>
          ({signStr}
          {pct}%)
        </span>
      )}
      {compareLabel && (
        <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{compareLabel}</span>
      )}
    </span>
  );
}
```

- [ ] **Step 3b: Migrate `StatsYearFilter.tsx`** — replace the import `import DeltaBadge from "./DeltaBadge";` with `import TrendDelta from "./TrendDelta";`, then replace every `<DeltaBadge current={X} compare={Y} />` with `<TrendDelta current={X} previous={Y} />`. The transform is identical for every occurrence: tag `DeltaBadge` → `TrendDelta`, prop `compare` → `previous`. (Grep first to find them: `cd frontend && npx grep-or-rg "DeltaBadge" src/components/Stats/StatsYearFilter.tsx` — expect ~4 usages.)

- [ ] **Step 3c: Delete the raw badge**

```bash
git rm frontend/src/components/Stats/DeltaBadge.tsx
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd frontend && npx vitest --run src/components/Stats/TrendDelta.test.tsx && npx tsc --noEmit`
Expected: TrendDelta tests PASS; tsc clean (no lingering `./DeltaBadge` import — if tsc reports one, that occurrence was missed in 3b; fix it).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Stats/TrendDelta.tsx frontend/src/components/Stats/TrendDelta.test.tsx frontend/src/components/Stats/StatsYearFilter.tsx
git commit -m "refactor(stats): consolidate DeltaBadge into token-based TrendDelta"
```

---

## Task 6: Web — API client `getTimeseries` + types

**Files:**
- Modify: `frontend/src/lib/api/types.ts` (add after the Stats block, ~line 346)
- Modify: `frontend/src/lib/api/stats.ts` (add method + import)

**Interfaces:**
- Produces (mirror of Task 3 response):
  ```ts
  interface TimeseriesPoint { period: string; count: number; distanceKm: number; durationMin: number }
  interface TimeseriesTotals { count: number; distanceKm: number; durationMin: number }
  interface TimeseriesResponse {
    domain: "flight" | "cruise";
    granularity: "month" | "year";
    window: { from: string; to: string };
    series: TimeseriesPoint[];
    current: TimeseriesTotals;
    previous: TimeseriesTotals;
  }
  interface TimeseriesParams {
    domain?: "flight" | "cruise";
    granularity?: "month" | "year";
    window?: "rolling12m" | "year" | "all";
    year?: number;
    fromDate?: string;
    toDate?: string;
  }
  ```
  `statsApi.getTimeseries(params?: TimeseriesParams): Promise<TimeseriesResponse>`

- [ ] **Step 1: Add the types** — in `frontend/src/lib/api/types.ts`, after `SummaryParams` (line 346):

```ts
// ==================== Timeseries Types ====================

export interface TimeseriesPoint {
  period: string; // "YYYY-MM" | "YYYY"
  count: number;
  distanceKm: number;
  durationMin: number;
}

export interface TimeseriesTotals {
  count: number;
  distanceKm: number;
  durationMin: number;
}

export interface TimeseriesResponse {
  domain: "flight" | "cruise";
  granularity: "month" | "year";
  window: { from: string; to: string };
  series: TimeseriesPoint[];
  current: TimeseriesTotals;
  previous: TimeseriesTotals;
}

export interface TimeseriesParams {
  domain?: "flight" | "cruise";
  granularity?: "month" | "year";
  window?: "rolling12m" | "year" | "all";
  year?: number;
  fromDate?: string;
  toDate?: string;
}
```

- [ ] **Step 2: Add the client method** — in `frontend/src/lib/api/stats.ts`, extend the type import (line 15) to include the new types and add the method after `getSummary` (line 22):

```ts
// line 15 becomes:
import type { SummaryParams, SummaryResponse, TimeseriesParams, TimeseriesResponse } from "./types";
```

```ts
// insert after getSummary (after line 22):
  getTimeseries: async (params?: TimeseriesParams): Promise<TimeseriesResponse> => {
    const { data } = await api.get<TimeseriesResponse>("/stats/timeseries", { params });
    return data;
  },
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api/types.ts frontend/src/lib/api/stats.ts
git commit -m "feat(stats): add getTimeseries API client method + types"
```

---

## Task 7: Web — `ScorecardTile` + `KpiScorecard`

**Files:**
- Create: `frontend/src/components/Stats/scorecard/ScorecardTile.tsx`
- Create: `frontend/src/components/Stats/scorecard/KpiScorecard.tsx`
- Test: `frontend/src/components/Stats/scorecard/KpiScorecard.test.tsx`

**Interfaces:**
- Consumes: `Sparkline` (Task 4), `TrendDelta` (Task 5).
- Produces:
  - `interface ScorecardTileVM { key: string; label: string; value: string; takeaway: string; points: number[]; current: number; previous: number }`
  - `ScorecardTile(props: ScorecardTileVM)` — default export
  - `KpiScorecard(props: { tiles: ScorecardTileVM[] })` — default export (responsive grid; presentational, no fetching)

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/Stats/scorecard/KpiScorecard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import KpiScorecard from "./KpiScorecard";
import type { ScorecardTileVM } from "./ScorecardTile";

const tiles: ScorecardTileVM[] = [
  { key: "flights", label: "Flüge", value: "42", takeaway: "letzte 12 Monate", points: [1, 2, 3], current: 42, previous: 30 },
  { key: "distance", label: "Distanz", value: "88.000 km", takeaway: "letzte 12 Monate", points: [3, 2, 1], current: 88000, previous: 90000 },
];

describe("KpiScorecard", () => {
  it("renders one tile per view-model with value, label, takeaway and a sparkline", () => {
    const { container } = render(<KpiScorecard tiles={tiles} />);
    expect(screen.getByText("Flüge")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("88.000 km")).toBeInTheDocument();
    expect(screen.getAllByText(/letzte 12 Monate/)).toHaveLength(2);
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });

  it("shows an up delta for the flights tile and a down delta for distance", () => {
    render(<KpiScorecard tiles={tiles} />);
    expect(screen.getByText(/↑/)).toBeInTheDocument();
    expect(screen.getByText(/↓/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Stats/scorecard/KpiScorecard.test.tsx`
Expected: FAIL — cannot resolve `./KpiScorecard`.

- [ ] **Step 3a: Write `ScorecardTile.tsx`**

```tsx
// frontend/src/components/Stats/scorecard/ScorecardTile.tsx
import type { JSX } from "react";
import Sparkline from "./Sparkline";
import TrendDelta from "../TrendDelta";

export interface ScorecardTileVM {
  key: string;
  label: string;
  value: string;
  takeaway: string;
  points: number[];
  current: number;
  previous: number;
}

// Hero KPI tile: big value + one-line takeaway (HIG), label-free sparkline
// (HIG sneak-peek), and a delta vs. the previous window (Few: current values
// need history).
export default function ScorecardTile({
  label,
  value,
  takeaway,
  points,
  current,
  previous,
}: ScorecardTileVM): JSX.Element {
  return (
    <div
      className="rounded-lg border p-5 shadow-md flex flex-col gap-2"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--color-border)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
        <TrendDelta current={current} previous={previous} />
      </div>
      <span className="text-4xl font-bold tabular-nums" style={{ color: "var(--accent)" }}>
        {value}
      </span>
      <div className="mt-1">
        <Sparkline points={points} filled />
      </div>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {takeaway}
      </span>
    </div>
  );
}
```

- [ ] **Step 3b: Write `KpiScorecard.tsx`**

```tsx
// frontend/src/components/Stats/scorecard/KpiScorecard.tsx
import type { JSX } from "react";
import ScorecardTile, { type ScorecardTileVM } from "./ScorecardTile";

interface KpiScorecardProps {
  tiles: ScorecardTileVM[];
}

// Hero row of KPI tiles. Presentational — the page builds the view-models.
export default function KpiScorecard({ tiles }: KpiScorecardProps): JSX.Element {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
      {tiles.map((tile) => (
        <ScorecardTile key={tile.key} {...tile} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/Stats/scorecard/KpiScorecard.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Stats/scorecard/ScorecardTile.tsx frontend/src/components/Stats/scorecard/KpiScorecard.tsx frontend/src/components/Stats/scorecard/KpiScorecard.test.tsx
git commit -m "feat(stats): add KPI scorecard tile + grid"
```

---

## Task 8: Web — `TimeRangeControl`

**Files:**
- Create: `frontend/src/components/Stats/scorecard/TimeRangeControl.tsx`
- Test: `frontend/src/components/Stats/scorecard/TimeRangeControl.test.tsx`

**Interfaces:**
- Produces: `type WindowKind = "rolling12m" | "year" | "all"`; `TimeRangeControl(props: { value: WindowKind; onChange: (w: WindowKind) => void })` — default export. Uses `useTranslation(["stats"])` for labels.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/Stats/scorecard/TimeRangeControl.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TimeRangeControl from "./TimeRangeControl";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("TimeRangeControl", () => {
  it("renders the three range options", () => {
    render(<TimeRangeControl value="rolling12m" onChange={() => {}} />);
    expect(screen.getByText("stats:timeRange.rolling12m")).toBeInTheDocument();
    expect(screen.getByText("stats:timeRange.year")).toBeInTheDocument();
    expect(screen.getByText("stats:timeRange.all")).toBeInTheDocument();
  });

  it("emits the selected window on click", () => {
    const onChange = vi.fn();
    render(<TimeRangeControl value="rolling12m" onChange={onChange} />);
    fireEvent.click(screen.getByText("stats:timeRange.all"));
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("marks the active option as pressed", () => {
    render(<TimeRangeControl value="year" onChange={() => {}} />);
    expect(screen.getByText("stats:timeRange.year").closest("button")).toHaveAttribute("aria-pressed", "true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Stats/scorecard/TimeRangeControl.test.tsx`
Expected: FAIL — cannot resolve `./TimeRangeControl`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/Stats/scorecard/TimeRangeControl.tsx
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";

export type WindowKind = "rolling12m" | "year" | "all";

interface TimeRangeControlProps {
  value: WindowKind;
  onChange: (w: WindowKind) => void;
}

const ORDER: WindowKind[] = ["rolling12m", "year", "all"];

// Segmented control driving the rolling/year/all-time window. "year" reuses
// the page's existing selectedYear (no second year picker in Wave A).
export default function TimeRangeControl({ value, onChange }: TimeRangeControlProps): JSX.Element {
  const { t } = useTranslation(["stats"]);
  return (
    <div
      className="inline-flex rounded-lg p-0.5 mb-4"
      style={{ background: "var(--bg-muted)", border: "1px solid var(--color-border)" }}
      role="group"
    >
      {ORDER.map((kind) => {
        const active = kind === value;
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(kind)}
            className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            style={{
              background: active ? "var(--accent)" : "transparent",
              color: active ? "#1a1205" : "var(--text-secondary)",
            }}
          >
            {t(`stats:timeRange.${kind}`)}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/Stats/scorecard/TimeRangeControl.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Stats/scorecard/TimeRangeControl.tsx frontend/src/components/Stats/scorecard/TimeRangeControl.test.tsx
git commit -m "feat(stats): add time-range segmented control"
```

---

## Task 9: Web — `CanonicalTimeSeries` chart

**Files:**
- Create: `frontend/src/components/Stats/scorecard/CanonicalTimeSeries.tsx`
- Test: `frontend/src/components/Stats/scorecard/CanonicalTimeSeries.test.tsx`

**Interfaces:**
- Consumes: `TimeseriesPoint` (Task 6), recharts.
- Produces: `CanonicalTimeSeries(props: { series: TimeseriesPoint[]; title: string })` — default export. One zero-baseline bar chart of `count` per period.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/Stats/scorecard/CanonicalTimeSeries.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CanonicalTimeSeries from "./CanonicalTimeSeries";

// recharts ResponsiveContainer needs a size; stub it to a fixed box.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div style={{ width: 600, height: 300 }}>{children}</div>
  ) };
});

describe("CanonicalTimeSeries", () => {
  it("renders the title", () => {
    render(<CanonicalTimeSeries title="Flüge pro Monat" series={[{ period: "2025-01", count: 3, distanceKm: 0, durationMin: 0 }]} />);
    expect(screen.getByText("Flüge pro Monat")).toBeInTheDocument();
  });

  it("renders an empty-state note when the series is all zeros", () => {
    render(<CanonicalTimeSeries title="Flüge pro Monat" series={[{ period: "2025-01", count: 0, distanceKm: 0, durationMin: 0 }]} />);
    expect(screen.getByText(/stats:timeRange.noData|keine|no data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Stats/scorecard/CanonicalTimeSeries.test.tsx`
Expected: FAIL — cannot resolve `./CanonicalTimeSeries`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/Stats/scorecard/CanonicalTimeSeries.tsx
import type { JSX } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useTranslation } from "../../../hooks/useTranslation";
import type { TimeseriesPoint } from "../../../lib/api/types";

interface CanonicalTimeSeriesProps {
  series: TimeseriesPoint[];
  title: string;
}

// The single canonical flights-per-period chart. Zero-baseline bars (HIG/M3:
// bar heights stay proportional). Replaces the redundant yearly+monthly pair.
export default function CanonicalTimeSeries({ series, title }: CanonicalTimeSeriesProps): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const hasData = series.some((p) => p.count > 0);

  return (
    <div
      className="rounded-lg shadow-lg p-6 mb-6"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
        {title}
      </h3>
      {hasData ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="period" stroke="var(--text-muted)" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
            <YAxis allowDecimals={false} domain={[0, "auto"]} stroke="var(--text-muted)" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                color: "var(--text-primary)",
              }}
            />
            <Bar dataKey="count" fill="var(--accent)" radius={[4, 4, 0, 0]} name={t("stats:timeBasedAnalytics.flightsLabel")} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-[300px]" style={{ color: "var(--text-muted)" }}>
          <p>{t("stats:timeRange.noData")}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/Stats/scorecard/CanonicalTimeSeries.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Stats/scorecard/CanonicalTimeSeries.tsx frontend/src/components/Stats/scorecard/CanonicalTimeSeries.test.tsx
git commit -m "feat(stats): add canonical flights-per-period chart"
```

---

## Task 10: Web — i18n keys (DE + EN)

**Files:**
- Modify: `frontend/src/i18n/resources/de/stats.json`
- Modify: `frontend/src/i18n/resources/en/stats.json`

**Interfaces:**
- Produces the i18n keys consumed by Tasks 8, 9, 11: `stats:timeRange.{rolling12m,year,all,noData}`, `stats:scorecard.{title,flights,distance,flightTime,takeaway}`, `stats:canonicalChart.flightsTitle`.

- [ ] **Step 1: Add the DE keys** — insert a `scorecard`, `timeRange`, and `canonicalChart` block into `de/stats.json` (e.g. after the `overview` block):

```json
  "timeRange": {
    "rolling12m": "12 Monate",
    "year": "Jahr",
    "all": "Gesamt",
    "noData": "Keine Daten im gewählten Zeitraum"
  },
  "scorecard": {
    "flights": "Flüge",
    "distance": "Distanz",
    "flightTime": "Flugzeit",
    "takeawayRolling": "letzte 12 Monate",
    "takeawayYear": "im Jahr {{year}}",
    "takeawayAll": "insgesamt",
    "comparePrev": "ggü. Vorzeitraum"
  },
  "canonicalChart": {
    "flightsTitle": "Flüge pro Zeitraum"
  },
```

- [ ] **Step 2: Add the EN keys** — mirror in `en/stats.json`:

```json
  "timeRange": {
    "rolling12m": "12 months",
    "year": "Year",
    "all": "All-time",
    "noData": "No data in the selected range"
  },
  "scorecard": {
    "flights": "Flights",
    "distance": "Distance",
    "flightTime": "Flight time",
    "takeawayRolling": "last 12 months",
    "takeawayYear": "in {{year}}",
    "takeawayAll": "all-time",
    "comparePrev": "vs. previous period"
  },
  "canonicalChart": {
    "flightsTitle": "Flights per period"
  },
```

- [ ] **Step 3: Validate JSON**

Run: `cd frontend && node -e "require('./src/i18n/resources/de/stats.json'); require('./src/i18n/resources/en/stats.json'); console.log('ok')"`
Expected: `ok` (no JSON parse error / trailing comma).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n/resources/de/stats.json frontend/src/i18n/resources/en/stats.json
git commit -m "feat(stats): add scorecard + time-range i18n keys (de/en)"
```

---

## Task 11: Web — wire the scorecard into `AdvancedStatsPage`

**Files:**
- Modify: `frontend/src/components/Stats/StatsChartsSection.tsx` (remove yearly + monthly blocks and their props)
- Modify: `frontend/src/pages/AdvancedStatsPage.tsx` (state + fetch + render; drop now-unused yearly/monthly computation)

**Interfaces:**
- Consumes: `statsApi.getTimeseries` (Task 6), `KpiScorecard` + `ScorecardTileVM` (Task 7), `TimeRangeControl` + `WindowKind` (Task 8), `CanonicalTimeSeries` (Task 9), i18n keys (Task 10).

- [ ] **Step 1: Trim `StatsChartsSection.tsx`** — remove the `yearlyData` and `monthlyData` props and the two chart blocks that render them (lines 58–143 in the current file: the "Yearly Trend" and "Monthly Bar Chart" `div`s), and drop `yearlyData`/`monthlyData` from `StatsChartsSectionProps` and the destructure. Keep the seasonal + weekday blocks untouched. Resulting props:

```tsx
interface StatsChartsSectionProps {
  seasonalData: SeasonalDataPoint[];
  weekdayData: WeekdayDataPoint[];
  hasFlights: boolean;
}
```

Also remove the now-unused `LineChart`, `Line` imports (keep `BarChart`, `Bar`, axes, etc. — still used by seasonal/weekday).

- [ ] **Step 2: Add imports + state to `AdvancedStatsPage.tsx`** — add imports near the other Stats imports (after line 35):

```tsx
import KpiScorecard from "../components/Stats/scorecard/KpiScorecard";
import type { ScorecardTileVM } from "../components/Stats/scorecard/ScorecardTile";
import TimeRangeControl, { type WindowKind } from "../components/Stats/scorecard/TimeRangeControl";
import CanonicalTimeSeries from "../components/Stats/scorecard/CanonicalTimeSeries";
import type { TimeseriesResponse } from "../lib/api/types";
import { formatDistance } from "../lib/units";
```

> If `formatDistance` is not the correct helper name in `lib/units`, use the same distance formatter `StatsDistanceSection` uses (grep `lib/units` for the exported distance formatter). The value only needs a localized number + unit.

Add state near the other `useState` calls (after line 60):

```tsx
const [rangeWindow, setRangeWindow] = useState<WindowKind>("rolling12m");
const [timeseries, setTimeseries] = useState<TimeseriesResponse | null>(null);
```

- [ ] **Step 3: Fetch the timeseries when the window (or selected year) changes** — add an effect (near the other effects). It maps the window to endpoint params; `year` reuses the existing `selectedYear`:

```tsx
useEffect(() => {
  const granularity = rangeWindow === "all" ? "year" : "month";
  const year = rangeWindow === "year" ? (selectedYear ?? undefined) : undefined;
  statsApi
    .getTimeseries({ domain: "flight", granularity, window: rangeWindow, year })
    .then(setTimeseries)
    .catch((err) => {
      logger.error("Failed to load timeseries", err);
      setTimeseries(null);
    });
}, [rangeWindow, selectedYear]);
```

- [ ] **Step 4: Build the tile view-models + render** — just inside the `filter === "flight"` block (before `<StatsYearFilter …>` at line 636), add:

```tsx
{(() => {
  const takeaway =
    rangeWindow === "rolling12m"
      ? t("stats:scorecard.takeawayRolling")
      : rangeWindow === "year"
        ? t("stats:scorecard.takeawayYear", { year: selectedYear ?? "" })
        : t("stats:scorecard.takeawayAll");
  const counts = timeseries?.series.map((p) => p.count) ?? [];
  const distances = timeseries?.series.map((p) => Math.round(p.distanceKm)) ?? [];
  const durations = timeseries?.series.map((p) => Math.round(p.durationMin / 60)) ?? [];
  const cur = timeseries?.current ?? { count: 0, distanceKm: 0, durationMin: 0 };
  const prev = timeseries?.previous ?? { count: 0, distanceKm: 0, durationMin: 0 };
  const tiles: ScorecardTileVM[] = [
    { key: "flights", label: t("stats:scorecard.flights"), value: String(cur.count), takeaway, points: counts, current: cur.count, previous: prev.count },
    { key: "distance", label: t("stats:scorecard.distance"), value: formatDistance(cur.distanceKm, units), takeaway, points: distances, current: cur.distanceKm, previous: prev.distanceKm },
    { key: "flightTime", label: t("stats:scorecard.flightTime"), value: `${Math.round(cur.durationMin / 60)} h`, takeaway, points: durations, current: cur.durationMin, previous: prev.durationMin },
  ];
  return (
    <>
      <TimeRangeControl value={rangeWindow} onChange={setRangeWindow} />
      <KpiScorecard tiles={tiles} />
      <CanonicalTimeSeries series={timeseries?.series ?? []} title={t("stats:canonicalChart.flightsTitle")} />
    </>
  );
})()}
```

> `units` and `t` are already in scope (lines 49–50). If `formatDistance(km, units)` has a different signature, adapt to the project's distance formatter — the tile value is display-only.

- [ ] **Step 5: Update the `StatsChartsSection` usage** — change the call (lines 675–681) to drop the removed props:

```tsx
<StatsChartsSection
  seasonalData={seasonalData}
  weekdayData={weekdayData}
  hasFlights={flights.length > 0}
/>
```

- [ ] **Step 6: Remove now-dead yearly/monthly computation** — delete the client-side `yearlyData` and `monthlyData` derivations in the page body (the memo/const blocks that build those two arrays; grep `yearlyData` / `monthlyData` in the file). Leave `seasonalData`/`weekdayData`. If a lint "unused variable" fires on an intermediate, remove that too.

- [ ] **Step 7: Typecheck, lint, test, build**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Expected: all green. Fix any type/lint fallout (most likely: a leftover `yearlyData` reference, or `formatDistance` signature).

- [ ] **Step 8: Manual smoke (real app)** — start the dev servers per CLAUDE.local.md, log in as `admin:admin123`, open `/stats`, flight tab. Verify: three KPI tiles with sparklines + delta pills appear; the segmented control switches 12 Monate/Jahr/Gesamt and the numbers + chart update; the old separate "Yearly Trend" and "Monthly Flights" charts are gone; seasonal/weekday charts remain.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/AdvancedStatsPage.tsx frontend/src/components/Stats/StatsChartsSection.tsx
git commit -m "feat(stats): wire scorecard + time-range + canonical chart into stats page"
```

---

## Task 12: Full-suite verification + GitNexus refresh

**Files:** none (verification only)

- [ ] **Step 1: Backend suite**

Run: `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`
Expected: green (includes the new `timeseries` unit + route tests).

- [ ] **Step 2: Frontend suite**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Expected: green (includes Sparkline, TrendDelta, KpiScorecard, TimeRangeControl, CanonicalTimeSeries).

- [ ] **Step 3: GitNexus scope check**

Run: `gitnexus_detect_changes({repo: "TravStats", scope: "all"})`
Expected: changed symbols limited to the timeseries endpoint, the new web components, and the page/section edits. No unexpected files.

- [ ] **Step 4: Re-index**

Run: `npx gitnexus analyze` (preserve embeddings with `--embeddings` if `.gitnexus/meta.json` shows `stats.embeddings > 0`).

---

## Self-Review

**Spec coverage:**
- `/stats/timeseries` endpoint (domain flight+cruise, rolling/year/all, series + current + previous, pure `utils/stats/timeseries.ts`, Jest) → Tasks 1–3. ✓
- Read-only, no migration → constraint honored; endpoint uses only `findMany`. ✓
- KPI scorecard (ScorecardTile, Sparkline, KpiScorecard) → Tasks 4, 7. ✓
- TimeRangeControl → Task 8. ✓
- CanonicalTimeSeries replacing the yearly/monthly pair → Task 9 + Task 11 Steps 1,5,6. ✓
- DeltaBadge consolidation onto the token-based version → Task 5 (new `TrendDelta`, migrate `StatsYearFilter`, delete raw badge). ✓
- API client `getTimeseries` + types → Task 6. ✓
- AdvancedStatsPage integration → Task 11. ✓
- DE/EN i18n → Task 10. ✓
- Vitest tests → Tasks 4,5,7,8,9. ✓
- App fast-follow explicitly deferred → stated in Global Constraints + spec §7 (no task here). ✓

**Deviation from spec (recorded):** hero KPI count is 3 (Flights, Distance, Flight time), not 4–6 — so every hero tile is uniform (all have a real sparkline from the lightweight endpoint). Airports/countries/cost tiles are deferred. Noted in Global Constraints.

**Placeholder scan:** No TBD/TODO. Two "adapt if the helper name differs" notes (`formatDistance`, and the `StatsYearFilter` DeltaBadge occurrences) are genuine "confirm-against-real-file" instructions with the exact fallback stated, not vague placeholders.

**Type consistency:** `TimeseriesPoint`/`TimeseriesTotals` identical in Task 3 (backend response), Task 6 (frontend types) and consumed in Tasks 9, 11. `ScorecardTileVM` defined in Task 7, consumed in Task 11. `WindowKind` defined in Task 8, imported in Task 11. `resolveWindow`/`bucketSeries`/`sumTotals` signatures consistent across Tasks 1–3. ✓
