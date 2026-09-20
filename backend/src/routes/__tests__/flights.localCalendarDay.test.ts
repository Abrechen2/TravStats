import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The logbook's year and month filter reads the DEPARTURE AIRPORT'S clock.
 *
 * That is this project's one answer to "which day was that"
 * (`airportCalendarDay`, forgejo#46), and it is already the answer two other
 * surfaces give: `FlightRow` formats the date with `flight.depTimezone`, and
 * `/stats/timeseries` buckets on `airportCalendarDay`
 * (`stats.timeseriesLocalTime.test.ts`). The first server-side version of
 * this filter bucketed on UTC instead, so a flight the row printed as
 * "31.12.2023" disappeared from the 2023 filter and turned up under 2024.
 *
 * The case that proves it is the pair below: TWO flights leaving at the SAME
 * UTC instant, 2024-01-01T02:00:00Z. In Los Angeles that is 18:00 on
 * 31 December; in Munich it is 03:00 on 1 January. One belongs to 2023 and
 * the other to 2024, and nothing about the stored timestamp says so.
 *
 * Runs against the real airport catalogue, because the zone comes from it —
 * a stub would let the test agree with a rule the app does not follow.
 */
describe("GET /api/v1/flights — year and month on the departure airport's clock", () => {
  let user: { id: string };
  let authCookie: string;
  let catalogueReady = false;
  const ids: Record<string, string> = {};

  const get = (path: string, query: Record<string, string | number>) =>
    request(app).get(path).query(query).set("Cookie", authCookie);

  beforeAll(async () => {
    const [lax, muc] = await Promise.all([
      prisma.airport.findFirst({ where: { iata: "LAX", isClosed: false } }),
      prisma.airport.findFirst({ where: { iata: "MUC", isClosed: false } }),
    ]);
    catalogueReady = Boolean(lax?.timezone && muc?.timezone);
    if (!catalogueReady) {
      // eslint-disable-next-line no-console
      console.warn(
        "SKIP: the airport catalogue has no zone for LAX/MUC — run the airport seed first."
      );
      return;
    }

    const timestamp = Date.now();
    user = await prisma.user.create({
      data: {
        username: `flights-local-day-${timestamp}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;

    const make = async (
      key: string,
      data: Parameters<typeof prisma.flight.create>[0]["data"]
    ): Promise<void> => {
      const row = await prisma.flight.create({ data });
      ids[key] = row.id;
    };

    // 2024-01-01T02:00:00Z = 2023-12-31 18:00 PST.
    await make("lax", {
      userId: user.id,
      airline: "American Airlines",
      depIata: "LAX",
      depLat: 33.9425,
      depLon: -118.4081,
      arrIata: "JFK",
      arrLat: 40.6413,
      arrLon: -73.7781,
      departureTime: new Date("2024-01-01T02:00:00Z"),
      depTimeSemantics: "UTC",
      status: "flown",
    });
    // The SAME instant, 03:00 on 1 January in Munich.
    await make("muc", {
      userId: user.id,
      airline: "Lufthansa",
      depIata: "MUC",
      depLat: 48.3538,
      depLon: 11.7861,
      arrIata: "JFK",
      arrLat: 40.6413,
      arrLon: -73.7781,
      departureTime: new Date("2024-01-01T02:00:00Z"),
      depTimeSemantics: "UTC",
      status: "flown",
    });
    // A legacy row stores wall clock AS fake UTC, so its own components are
    // the local reading and the zone must NOT be applied a second time.
    await make("legacy", {
      userId: user.id,
      airline: "American Airlines",
      depIata: "LAX",
      depLat: 33.9425,
      depLon: -118.4081,
      arrIata: "JFK",
      arrLat: 40.6413,
      arrLon: -73.7781,
      departureTime: new Date("2023-12-31T18:00:00Z"),
      depTimeSemantics: "LEGACY_FAKE_UTC",
      status: "flown",
    });
  });

  afterAll(async () => {
    if (!catalogueReady) return;
    await prisma.flight.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  const idsOf = (body: { flights: Array<{ id: string }> }): string[] =>
    body.flights.map((f) => f.id).sort();

  it("files an LAX departure at 18:00 on 31 December under that year, not the next", async () => {
    if (!catalogueReady) return;
    const res = await get("/api/v1/flights", { year: 2023 });
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([ids.lax, ids.legacy].sort());
    expect(res.body.total).toBe(2);
  });

  it("files the SAME instant leaving Munich under the next year", async () => {
    if (!catalogueReady) return;
    const res = await get("/api/v1/flights", { year: 2024 });
    expect(idsOf(res.body)).toEqual([ids.muc]);
  });

  it("reads the month on the same clock", async () => {
    if (!catalogueReady) return;
    const december = await get("/api/v1/flights", { year: 2023, month: 12 });
    expect(idsOf(december.body)).toEqual([ids.lax, ids.legacy].sort());

    const january = await get("/api/v1/flights", { year: 2024, month: 1 });
    expect(idsOf(january.body)).toEqual([ids.muc]);
  });

  it("reads a month named without a year on the same clock", async () => {
    if (!catalogueReady) return;
    const res = await get("/api/v1/flights", { month: 12 });
    expect(idsOf(res.body)).toEqual([ids.lax, ids.legacy].sort());
  });

  it("does not re-apply the zone to a LEGACY_FAKE_UTC row", async () => {
    if (!catalogueReady) return;
    // Its stored 18:00 IS the local reading. Converting it to LA time again
    // would move it to 10:00 on the same day here — harmless — but the
    // failure mode this pins is the reverse case that shifts the DATE.
    const res = await get("/api/v1/flights", { year: 2023, month: 12 });
    expect(idsOf(res.body)).toContain(ids.legacy);
  });

  it("pages the filtered set, and counts it, on the same clock", async () => {
    if (!catalogueReady) return;
    const res = await get("/api/v1/flights", { year: 2023, limit: 1, offset: 0 });
    expect(res.body.flights).toHaveLength(1);
    expect(res.body.total).toBe(2);
  });

  it("answers an empty result for a year nobody flew in", async () => {
    if (!catalogueReady) return;
    const res = await get("/api/v1/flights", { year: 1999 });
    expect(res.body.flights).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("counts the year facet on the same clock", async () => {
    if (!catalogueReady) return;
    const res = await get("/api/v1/flights/facets", {});
    expect(res.body.years).toEqual([
      { value: 2024, count: 1 },
      { value: 2023, count: 2 },
    ]);
  });

  it("narrows the map to the same rows", async () => {
    if (!catalogueReady) return;
    // `/geo` is the third caller of the filter; a year that means one thing
    // in the table and another on the map is the bug one level along.
    const res = await get("/api/v1/flights/geo", { year: 2023 });
    expect(res.body.features).toHaveLength(2);
  });

  it("agrees with what /stats/timeseries counts for the same account", async () => {
    if (!catalogueReady) return;
    // `window: all`, because the default rolling year does not reach 2023.
    const res = await get("/api/v1/stats/timeseries", { granularity: "year", window: "all" });
    expect(res.status).toBe(200);
    const series = res.body.series as Array<{ period: string; count: number }>;
    const byPeriod = new Map(series.map((p) => [p.period, p.count]));
    // The same split the list reports: two in 2023, one in 2024.
    expect(byPeriod.get("2023")).toBe(2);
    expect(byPeriod.get("2024")).toBe(1);
  });
});
