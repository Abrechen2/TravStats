import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFlightFindMany = jest.fn();
const mockCruiseFindMany = jest.fn();
const mockGetCachedAirports = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    flight: { findMany: mockFlightFindMany },
    cruise: { findMany: mockCruiseFindMany },
  },
}));
jest.mock("../services/airportCache", () => ({
  getCachedAirports: mockGetCachedAirports,
}));
jest.mock("../middleware/auth", () => ({
  authenticate: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = "u1";
    next();
  },
  AuthRequest: {},
}));

import request from "supertest";
import express from "express";

/**
 * Real catalogue airports, with the coordinates and IANA zones the catalogue
 * carries. The route resolves a departure timezone by airport code, so the
 * codes have to be real ones for the fixture to describe a flight that could
 * actually have happened.
 *
 * HGA stands for the thin end of the catalogue: an airport that is on file
 * but whose row carries no timezone. `buildTzMap` only records a code when
 * `data.timezone` is set, so a null here reaches the route as "unknown zone".
 */
const AIRPORT_DB: Record<
  string,
  { lat: number; lon: number; country: string; timezone: string | null }
> = {
  BKK: { lat: 13.69, lon: 100.7501, country: "TH", timezone: "Asia/Bangkok" },
  SIN: { lat: 1.3644, lon: 103.9915, country: "SG", timezone: "Asia/Singapore" },
  LAX: { lat: 33.9425, lon: -118.4081, country: "US", timezone: "America/Los_Angeles" },
  JFK: { lat: 40.6398, lon: -73.7789, country: "US", timezone: "America/New_York" },
  DXB: { lat: 25.2528, lon: 55.3644, country: "AE", timezone: "Asia/Dubai" },
  HGA: { lat: 9.5182, lon: 44.0888, country: "SO", timezone: null },
};

function airport(code: string): { lat: number; lon: number } {
  const entry = AIRPORT_DB[code];
  if (!entry) throw new Error(`fixture references an airport that is not in the stub: ${code}`);
  return entry;
}

/**
 * A row shaped like the `select` in `fetchFlightDatedRows`. `dep`/`arr` are
 * codes so a case reads as a route rather than as four coordinates.
 */
function flightRow(
  dep: string,
  arr: string,
  departureTime: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    depIata: dep,
    depIcao: null,
    depLat: airport(dep).lat,
    depLon: airport(dep).lon,
    arrIata: arr,
    arrIcao: null,
    arrLat: airport(arr).lat,
    arrLon: airport(arr).lon,
    departureTime: new Date(departureTime),
    arrivalTime: null,
    depTimeSemantics: "UTC",
    arrTimeSemantics: "UTC",
    status: "flown",
    ...overrides,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

interface SeriesPoint {
  period: string;
  count: number;
  distanceKm: number;
  durationMin: number;
}

function isSeriesPoint(value: unknown): value is SeriesPoint {
  return (
    isRecord(value) &&
    typeof value.period === "string" &&
    typeof value.count === "number" &&
    typeof value.distanceKm === "number" &&
    typeof value.durationMin === "number"
  );
}

function periodsOf(body: unknown): string[] {
  const series = isRecord(body) ? body.series : undefined;
  if (!Array.isArray(series)) throw new Error("the response carries no series");
  return series.filter(isSeriesPoint).map((p) => p.period);
}

/** The bucket for `period`, or a loud failure — an absent bucket is a result. */
function bucketOf(body: unknown, period: string): SeriesPoint {
  const series = isRecord(body) ? body.series : undefined;
  if (!Array.isArray(series)) throw new Error("the response carries no series");
  const point = series.filter(isSeriesPoint).find((p) => p.period === period);
  if (!point) throw new Error(`the series has no ${period} bucket`);
  return point;
}

interface WindowTotals {
  count: number;
  distanceKm: number;
  durationMin: number;
}

function totalsOf(body: unknown, key: "current" | "previous"): WindowTotals {
  const totals = isRecord(body) ? body[key] : undefined;
  if (!isRecord(totals) || typeof totals.count !== "number") {
    throw new Error(`the response carries no ${key} totals`);
  }
  return {
    count: totals.count,
    distanceKm: typeof totals.distanceKm === "number" ? totals.distanceKm : 0,
    durationMin: typeof totals.durationMin === "number" ? totals.durationMin : 0,
  };
}

/**
 * The `departureTime.gte` the route actually asked the database for. The
 * fetcher widens the query by a day at each edge; with a mocked Prisma the
 * widening is invisible in the result, so it is read off the call instead.
 */
function fetchLowerBound(args: unknown): Date {
  const arg = Array.isArray(args) ? args[0] : undefined;
  const where = isRecord(arg) ? arg.where : undefined;
  const departureTime = isRecord(where) ? where.departureTime : undefined;
  const gte = isRecord(departureTime) ? departureTime.gte : undefined;
  if (!(gte instanceof Date)) throw new Error("the query carries no departureTime.gte");
  return gte;
}

describe("GET /api/v1/stats/timeseries — buckets read the clock at the departure airport (forgejo#46)", () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    mockFlightFindMany.mockReset();
    mockCruiseFindMany.mockReset();
    mockGetCachedAirports.mockReset();
    mockGetCachedAirports.mockImplementation(async (...args: unknown[]) => {
      const codes = args[0] as string[];
      const map = new Map<string, unknown>();
      for (const code of codes) {
        const upper = code.toUpperCase();
        if (AIRPORT_DB[upper]) map.set(upper, AIRPORT_DB[upper]);
      }
      return map;
    });
    const { default: statsRoutes } = await import("./stats");
    app = express();
    app.use(express.json());
    app.use("/api/v1/stats", statsRoutes);
  });

  it("files an early-morning Bangkok departure on 1 January under the new year", async () => {
    // The core of the bug. 06:00 on 1 January in Bangkok (UTC+7) is 23:00 on
    // 31 December in UTC, so the two rules disagree by a whole year: the
    // airport clock says 2026, the stored instant says 2025.
    mockFlightFindMany.mockResolvedValue([flightRow("BKK", "SIN", "2025-12-31T23:00:00Z")]);

    const res = await request(app).get(
      "/api/v1/stats/timeseries?domain=flight&granularity=year&fromDate=2025-01-01&toDate=2027-01-01"
    );

    expect(res.status).toBe(200);
    expect(periodsOf(res.body)).toEqual(["2025", "2026"]);
    expect(bucketOf(res.body, "2026").count).toBe(1);
    // The neighbouring bucket has to be empty, not merely smaller: a row that
    // was duplicated into both years would satisfy the assertion above alone.
    expect(bucketOf(res.body, "2025").count).toBe(0);
    expect(totalsOf(res.body, "current").count).toBe(1);
  });

  it("keeps a late-evening Los Angeles departure on 31 December in the old year", async () => {
    // The mirror image, west of UTC. 22:00 on 31 December in Los Angeles
    // (PST, UTC-8) is already 06:00 on 1 January in UTC. Reading the stored
    // instant would push the flight forward into a year it never happened in.
    mockFlightFindMany.mockResolvedValue([flightRow("LAX", "JFK", "2026-01-01T06:00:00Z")]);

    const res = await request(app).get(
      "/api/v1/stats/timeseries?domain=flight&granularity=year&fromDate=2025-01-01&toDate=2027-01-01"
    );

    expect(res.status).toBe(200);
    expect(bucketOf(res.body, "2025").count).toBe(1);
    expect(bucketOf(res.body, "2026").count).toBe(0);
    expect(totalsOf(res.body, "current").count).toBe(1);
  });

  it("counts that Bangkok departure inside window=year for the new year", async () => {
    // The window edge is airport-local too, not just the bucket. Under the old
    // rule the row was not even fetched: the query filtered on the stored
    // instant, which falls a day short of 1 January 2026. The fetcher now
    // widens by a day at each edge and `withinWindow` decides membership on
    // the local calendar day — so the totals and the series agree.
    mockFlightFindMany
      .mockResolvedValueOnce([flightRow("BKK", "SIN", "2025-12-31T23:00:00Z")])
      .mockResolvedValueOnce([]);

    const res = await request(app).get(
      "/api/v1/stats/timeseries?domain=flight&granularity=year&window=year&year=2026"
    );

    expect(res.status).toBe(200);
    // `current`, not only the series — the two used to be computed from
    // different populations, which is the whole reason `withinWindow` exists.
    expect(totalsOf(res.body, "current").count).toBe(1);
    expect(totalsOf(res.body, "current").distanceKm).toBeGreaterThan(0);
    expect(bucketOf(res.body, "2026").count).toBe(1);
    expect(totalsOf(res.body, "previous").count).toBe(0);

    // The widening is what makes the row reachable at all, and a mocked Prisma
    // cannot show it — so read it off the query the route issued.
    const lowerBound = fetchLowerBound(mockFlightFindMany.mock.calls[0]);
    expect(lowerBound.getTime()).toBeLessThanOrEqual(Date.UTC(2025, 11, 31, 0, 0, 0));
  });

  it("keeps the margin rows the widened query drags in out of the totals", async () => {
    // The `sumTotals`-vs-`bucketSeries` trap. Both rows are genuinely outside
    // the 2026 window on the airport clock, and both sit inside the one-day
    // fetch margin, so a real query returns them:
    //   LAX 2026-01-01T06:00Z is 31 December 2025 locally — before the window.
    //   BKK 2026-12-31T23:00Z is  1 January  2027 locally — after  the window.
    // `bucketSeries` filters internally and would look right regardless;
    // `sumTotals` does not, so without `withinWindow` the headline totals would
    // silently count margin rows the chart beneath them does not show.
    const margins = [
      flightRow("LAX", "JFK", "2026-01-01T06:00:00Z"),
      flightRow("BKK", "SIN", "2026-12-31T23:00:00Z"),
    ];
    mockFlightFindMany.mockResolvedValue(margins);

    const res = await request(app).get(
      "/api/v1/stats/timeseries?domain=flight&granularity=year&window=year&year=2026"
    );

    expect(res.status).toBe(200);
    expect(totalsOf(res.body, "current").count).toBe(0);
    expect(totalsOf(res.body, "current").distanceKm).toBe(0);
    expect(bucketOf(res.body, "2026").count).toBe(0);
    // The previous window (2025) is trimmed by the same helper, and the LAX row
    // does belong there — so this pins the filter, not a blanket rejection.
    expect(totalsOf(res.body, "previous").count).toBe(1);
  });

  it("buckets a DATE_ONLY row on the date it carries", async () => {
    // A historical row has no real clock: it stores a 12:00 placeholder and is
    // tagged DATE_ONLY. `localWallClockOf` still reads such a row through the
    // airport's zone — only the HOUR is dropped — but 12:00 sits far enough
    // from midnight that no real airport offset can move the DATE. So the day
    // the row carries is the day it buckets on, east and west of UTC alike,
    // and no timezone shifting is ever visible on it.
    mockFlightFindMany.mockResolvedValue([
      flightRow("BKK", "SIN", "2020-06-15T12:00:00Z", {
        depTimeSemantics: "DATE_ONLY",
        arrTimeSemantics: "DATE_ONLY",
        status: "historical",
      }),
      flightRow("LAX", "JFK", "2020-06-15T12:00:00Z", {
        depTimeSemantics: "DATE_ONLY",
        arrTimeSemantics: "DATE_ONLY",
        status: "historical",
      }),
    ]);

    const res = await request(app).get(
      "/api/v1/stats/timeseries?domain=flight&granularity=month&fromDate=2020-06-01&toDate=2020-08-01"
    );

    expect(res.status).toBe(200);
    expect(bucketOf(res.body, "2020-06").count).toBe(2);
    expect(bucketOf(res.body, "2020-07").count).toBe(0);
    expect(totalsOf(res.body, "current").count).toBe(2);
  });

  it("still counts a flight whose airport has no known timezone", async () => {
    // HGA is on file without a timezone. The stored components are then the
    // only reading available, so the row falls back to them — it must not be
    // dropped from the series for lacking a clock. A stat that quietly loses
    // flights is worse than one that reads them approximately.
    mockFlightFindMany.mockResolvedValue([flightRow("HGA", "DXB", "2026-03-10T09:00:00Z")]);

    const res = await request(app).get(
      "/api/v1/stats/timeseries?domain=flight&granularity=month&fromDate=2026-03-01&toDate=2026-04-01"
    );

    expect(res.status).toBe(200);
    expect(bucketOf(res.body, "2026-03").count).toBe(1);
    expect(totalsOf(res.body, "current").count).toBe(1);
  });
});
