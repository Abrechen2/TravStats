import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `?year=` on the stats endpoints the Companion's Gesamt/Jahr switch reads
 * (docs/superpowers/specs/2026-10-25-companion-redesign.md, C4).
 *
 * The fixture's edge case is the point: a Tokyo departure at 20:00 UTC on
 * 31 December is 05:00 on 1 January in Tokyo. It belongs to the NEXT local
 * year, so a UTC year filter would put it in the wrong one.
 */
describe("stats ?year= scope (companion-redesign C4)", () => {
  const username = "statsYearScopeUser";
  let cookie: string;
  let userId: string;

  async function fly(departure: string, over: Record<string, unknown> = {}): Promise<void> {
    await prisma.flight.create({
      data: {
        userId,
        status: "flown",
        depIata: "NRT",
        arrIata: "KIX",
        depLat: 35.77,
        depLon: 140.39,
        arrLat: 34.43,
        arrLon: 135.24,
        depTimezone: "Asia/Tokyo",
        arrTimezone: "Asia/Tokyo",
        depTimeSemantics: "UTC",
        arrTimeSemantics: "UTC",
        airline: "Japan Airlines",
        airlineIata: "JL",
        aircraft: "Boeing 787-9",
        delayMinutes: 12,
        departureTime: new Date(departure),
        arrivalTime: new Date(new Date(departure).getTime() + 80 * 60_000),
        ...over,
      },
    });
  }

  const get = (path: string) => request(app).get(`/api/v1${path}`).set("Cookie", cookie);

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username } });
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    await fly("2025-06-10T03:00:00Z", { airlineIata: "NH", airline: "ANA" }); // 2025
    await fly("2025-12-31T20:00:00Z"); // 2026-01-01 05:00 in Tokyo → 2026
    await fly("2026-03-05T03:00:00Z"); // 2026
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
  });

  it("summary counts the New Year's Eve departure in the local year and says so", async () => {
    const y2025 = await get("/stats/summary?year=2025");
    const y2026 = await get("/stats/summary?year=2026");
    const all = await get("/stats/summary");
    expect(y2025.body.totalFlights).toBe(1);
    expect(y2026.body.totalFlights).toBe(2);
    expect(all.body.totalFlights).toBe(3);
    expect(y2026.body.scope).toEqual({ year: 2026 });
    expect(all.body.scope).toEqual({ year: null });
  });

  it("airlines ranks only the year's flights", async () => {
    const res = await get("/stats/airlines?year=2025");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.scope).toEqual({ year: 2025 });
    expect((await get("/stats/airlines")).body.total).toBe(3);
  });

  it("aircraft-types shares the airlines denominator for the year", async () => {
    const res = await get("/stats/aircraft-types?year=2026");
    expect(res.body.total).toBe(2);
    expect(res.body.aircraftTypes[0]).toMatchObject({ aircraft: "Boeing 787-9", count: 2 });
    expect(res.body.scope).toEqual({ year: 2026 });
  });

  it("airports, punctuality and records narrow to the year", async () => {
    const airports = await get("/stats/airports?year=2025");
    expect(airports.status).toBe(200);
    expect(airports.body.scope).toEqual({ year: 2025 });

    const punctuality = await get("/stats/punctuality?year=2026");
    expect(punctuality.body.sampleSize).toBe(2);
    expect(punctuality.body.scope).toEqual({ year: 2026 });
    expect((await get("/stats/punctuality")).body.sampleSize).toBe(3);

    const records = await get("/stats/records?year=2025");
    expect(records.body.data.scope).toEqual({ year: 2025 });
    const busiest = records.body.data.records.find((r: { id: string }) => r.id === "busiest-day");
    expect(busiest.value).toBe(1);
  });

  it("timeseries with year alone answers that year's twelve months", async () => {
    const res = await get("/stats/timeseries?year=2026");
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(12);
    expect(res.body.current.count).toBe(2);
    expect(res.body.scope).toEqual({ year: 2026 });
  });

  it("timeseries keeps an explicit window and reports it as unscoped", async () => {
    const res = await get("/stats/timeseries?year=2026&window=all");
    expect(res.status).toBe(200);
    expect(res.body.current.count).toBe(3);
    expect(res.body.scope).toEqual({ year: null });
  });

  it.each([
    "/stats/summary?year=2026&fromDate=2026-01-01",
    "/stats/airports?year=2026&toDate=2026-12-31",
    "/stats/punctuality?year=2026&fromDate=2026-01-01",
    "/stats/timeseries?year=2026&fromDate=2026-01-01",
  ])("refuses year and a date range together: %s", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", field: "year" });
  });

  it.each(["/stats/airlines", "/stats/aircraft-types", "/stats/records", "/stats/airports"])(
    "rejects an invalid year: %s",
    async (path) => {
      expect((await get(`${path}?year=abc`)).status).toBe(400);
    }
  );

  it("lodging, cruise and rail report the scope they already honoured", async () => {
    expect((await get("/stats/lodging?year=2026")).body.data.scope).toEqual({ year: 2026 });
    expect((await get("/stats/cruise?year=2026")).body.scope).toEqual({ year: 2026 });
    expect((await get("/rail/stats?year=2026")).body.data.scope).toEqual({ year: 2026 });
    expect((await get("/rail/stats")).body.data.scope).toEqual({ year: null });
  });
});
