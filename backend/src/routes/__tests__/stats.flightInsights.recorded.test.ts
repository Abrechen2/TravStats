import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { resolveMetricEvidence } from "../../services/evidence/metricEvidence";

/** The recorded-fields block of /stats/flight-insights, and the lists behind its figures. */
describe("flight insights: fields only enriched flights carry", () => {
  let userId: string;
  let emptyUserId: string;
  const ids: Record<string, string> = {};
  const page = { offset: 0, limit: 50 };
  const allTime = { period: { kind: "allTime" as const } };

  const base = (departure: string) => ({
    userId,
    depIata: "FRA",
    arrIata: "LIS",
    depLat: 50.033,
    depLon: 8.571,
    arrLat: 38.774,
    arrLon: -9.134,
    depTimezone: "Europe/Berlin",
    arrTimezone: "Europe/Lisbon",
    depTimeSemantics: "UTC",
    arrTimeSemantics: "UTC",
    departureTime: new Date(departure),
    arrivalTime: new Date(new Date(departure).getTime() + 3 * 3_600_000),
  });

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `rec-${Date.now()}-${Math.random()}`, passwordHash: "x" },
      })
    ).id;
    emptyUserId = (
      await prisma.user.create({
        data: { username: `rec0-${Date.now()}-${Math.random()}`, passwordHash: "x" },
      })
    ).id;
    const make = async (name: string, departure: string, extra: object) => {
      ids[name] = (await prisma.flight.create({ data: { ...base(departure), ...extra } })).id;
    };
    await make("enriched", "2024-03-01T08:00:00Z", {
      status: "flown",
      runwayDepartureTime: new Date("2024-03-01T08:20:00Z"),
      runwayArrivalTime: new Date("2024-03-01T10:50:00Z"),
      overflownCountries: ["Germany", "France"],
      isCodeshare: true,
      operatingAirline: "TAP",
    });
    await make("plain", "2024-04-01T08:00:00Z", { status: "flown" });
    await make("planned", "2031-04-01T08:00:00Z", {
      status: "scheduled",
      runwayDepartureTime: new Date("2031-04-01T08:20:00Z"),
      runwayArrivalTime: new Date("2031-04-01T10:50:00Z"),
      overflownCountries: ["Spain"],
      isCodeshare: true,
    });
    await prisma.flight.create({
      data: { ...base("2024-05-01T08:00:00Z"), userId: emptyUserId, status: "flown" },
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, emptyUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, emptyUserId] } } });
  });

  it("answers each field with its own coverage over flown flights only", async () => {
    const res = await request(app)
      .get("/api/v1/stats/flight-insights")
      .set("Cookie", `auth_token=${generateToken(userId)}`);
    expect(res.status).toBe(200);
    expect(res.body.recorded).toEqual({
      airborne: { minutes: 150, flights: 1, of: 2 },
      overflown: { countries: ["France", "Germany"], flights: 1, of: 2 },
      codeshare: { codeshare: 1, known: 1, of: 2, operators: [{ name: "TAP", flights: 1 }] },
    });
  });

  it("answers null, not zero, for a logbook whose flights carry none of them", async () => {
    const res = await request(app)
      .get("/api/v1/stats/flight-insights")
      .set("Cookie", `auth_token=${generateToken(emptyUserId)}`);
    expect(res.body.recorded).toEqual({ airborne: null, overflown: null, codeshare: null });
  });

  it("lists behind each figure exactly the flights it counted", async () => {
    const air = await resolveMetricEvidence(userId, "flightAirborneMinutes", allTime, page);
    expect(air!.measure.value).toBe(150);
    expect(air!.entries.map((e) => e.id)).toEqual([ids.enriched]);

    const countries = await resolveMetricEvidence(
      userId,
      "flightOverflownCountriesCount",
      allTime,
      page
    );
    expect(countries!.measure.value).toBe(2);
    expect(countries!.entries.map((e) => e.id)).toEqual([ids.enriched]);

    const shared = await resolveMetricEvidence(userId, "flightCodeshareCount", allTime, page);
    expect(shared!.measure.value).toBe(1);
    expect(shared!.entries.map((e) => e.id)).toEqual([ids.enriched]);
  });
});
