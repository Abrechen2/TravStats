import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { resolveMetricEvidence } from "../../services/evidence/metricEvidence";
import { calculateInsightAchievementStats } from "../../utils/insightAchievements";

/**
 * forgejo#256, end to end: discovery, the long return, network growth and a
 * transfer measured only between two flights of one booking — through the
 * endpoint, the evidence resolvers and the badge fold, which must agree.
 */
describe("GET /stats/flight-insights", () => {
  let userId: string;
  let authCookie: string;
  const ids: Record<string, string> = {};
  const page = { offset: 0, limit: 50 };

  const AIRPORTS = {
    FRA: { lat: 50.033, lon: 8.571, zone: "Europe/Berlin" },
    LIS: { lat: 38.774, lon: -9.134, zone: "Europe/Lisbon" },
    MUC: { lat: 48.354, lon: 11.786, zone: "Europe/Berlin" },
    JFK: { lat: 40.64, lon: -73.779, zone: "America/New_York" },
    BOS: { lat: 42.364, lon: -71.005, zone: "America/New_York" },
  } as const;
  type Code = keyof typeof AIRPORTS;

  async function fly(
    name: string,
    dep: Code,
    arr: Code,
    departure: string,
    arrival: string,
    extra: { bookingId?: string; status?: string } = {}
  ): Promise<void> {
    const flight = await prisma.flight.create({
      data: {
        userId,
        status: extra.status ?? "flown",
        bookingId: extra.bookingId ?? null,
        depIata: dep,
        arrIata: arr,
        depLat: AIRPORTS[dep].lat,
        depLon: AIRPORTS[dep].lon,
        arrLat: AIRPORTS[arr].lat,
        arrLon: AIRPORTS[arr].lon,
        depTimezone: AIRPORTS[dep].zone,
        arrTimezone: AIRPORTS[arr].zone,
        depTimeSemantics: "UTC",
        arrTimeSemantics: "UTC",
        departureTime: new Date(departure),
        arrivalTime: new Date(arrival),
      },
    });
    ids[name] = flight.id;
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `insights-${Date.now()}-${Math.random()}`, passwordHash: "x" },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(userId)}`;
    const booking = await prisma.booking.create({ data: { userId } });

    await fly("lisOut", "FRA", "LIS", "2014-06-10T08:00:00Z", "2014-06-10T10:00:00Z");
    await fly("feeder", "MUC", "FRA", "2024-03-02T06:00:00Z", "2024-03-02T07:00:00Z", {
      bookingId: booking.id,
    });
    await fly("longHaul", "FRA", "JFK", "2024-03-02T09:15:00Z", "2024-03-02T17:00:00Z", {
      bookingId: booking.id,
    });
    // An hour later, but in no booking: never a "connection".
    await fly("unlinked", "JFK", "BOS", "2024-03-02T18:00:00Z", "2024-03-02T19:00:00Z");
    await fly("lisBack", "LIS", "FRA", "2024-06-12T08:00:00Z", "2024-06-12T11:00:00Z");
    await fly("cancelled", "FRA", "BOS", "2024-07-01T08:00:00Z", "2024-07-01T16:00:00Z", {
      status: "cancelled",
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.booking.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("answers discovery, returns and transfers for the latest year by default", async () => {
    const res = await request(app).get("/api/v1/stats/flight-insights").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    const body = res.body;

    expect(body.history).toMatchObject({ firstYear: 2014, lastYear: 2024, countedFlights: 5 });
    const y2024 = body.years.find((y: { year: number }) => y.year === 2024);
    expect(y2024.newAirports).toEqual(["BOS", "JFK", "MUC"]);
    expect(y2024.airportsUsed).toBe(5);
    expect(y2024.discoveryRate).toBeCloseTo(3 / 5);
    expect(y2024.repeatedConnections).toEqual(["FRA-LIS"]);

    expect(body.reunions[0]).toMatchObject({
      airport: "LIS",
      years: 10,
      fromFlightId: ids.lisOut,
      toFlightId: ids.lisBack,
    });

    expect(body.transfers.years).toHaveLength(1);
    expect(body.transfers.shortest).toMatchObject({
      minutes: 135,
      airport: "FRA",
      arrivingFlightId: ids.feeder,
      departingFlightId: ids.longHaul,
    });
    expect(body.transfers.coverage).toMatchObject({ bookings: 1, gaps: 1, measured: 1 });

    expect(body.story.year).toBe(2024);
    expect(body.story.curiousRepetition).toMatchObject({
      kind: "reunion",
      reunion: { airport: "LIS", years: 10 },
    });
    expect(body.story.transfers).toEqual({ count: 1, shortestMinutes: 135 });
  });

  it("tells the requested year, and claims no change against an empty year before", async () => {
    const res = await request(app)
      .get("/api/v1/stats/flight-insights?year=2014")
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.story).toMatchObject({ year: 2014, newAirports: ["FRA", "LIS"] });
    expect(res.body.story.biggestChange).toBeNull();
  });

  it("refuses a year outside the calendar it knows", async () => {
    const res = await request(app)
      .get("/api/v1/stats/flight-insights?year=1800")
      .set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  it("lists behind each count exactly the flights the section counted", async () => {
    const year = { period: { kind: "year" as const, year: 2024 } };
    const newAirports = await resolveMetricEvidence(userId, "flightNewAirportsCount", year, page);
    expect(newAirports!.measure.value).toBe(3);
    expect(newAirports!.entries.map((e) => e.id).sort()).toEqual(
      [ids.feeder, ids.longHaul, ids.unlinked].sort()
    );

    const transfers = await resolveMetricEvidence(userId, "flightTransferCount", year, page);
    expect(transfers!.measure.value).toBe(1);
    expect(transfers!.entries.map((e) => e.id)).toEqual([ids.feeder]);

    const repeated = await resolveMetricEvidence(
      userId,
      "flightRepeatedConnectionsCount",
      year,
      page
    );
    expect(repeated!.measure.value).toBe(1);
    expect(repeated!.entries.map((e) => e.id)).toEqual([ids.lisBack]);
  });

  it("feeds the badges from the same fold", async () => {
    const stats = await calculateInsightAchievementStats(userId);
    expect(stats.flightAirportReunionYears).toBe(10);
    expect(stats.flightNewAirportsYearMax).toBe(3);
    expect(stats.flightAirportQuartersMax).toBe(2);
  });
});
