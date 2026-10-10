import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#265 — a same-span comparison figure ("2026 up to 10 Oct against the
 * same span of 2025") opens exactly the rides it counted: `period=range`.
 * Only measures whose registry lists `range` accept it; every other answers
 * 400 rather than quietly reading the span as a year or as lifetime.
 */
describe("GET /api/v1/evidence/metric/... — period=range", () => {
  let cookie: string;
  let userId: string;

  const ride = (dep: string, arr: string) =>
    prisma.railJourney.create({
      data: {
        userId,
        depStationName: "Köln Hbf",
        depLat: 50.9432,
        depLon: 6.9586,
        depTimezone: "Europe/Berlin",
        arrStationName: "Frankfurt (Main) Hbf",
        arrLat: 50.1071,
        arrLon: 8.6632,
        arrTimezone: "Europe/Berlin",
        departureTime: new Date(dep),
        arrivalTime: new Date(arr),
        status: "completed",
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidencerange" } });
    userId = (
      await prisma.user.create({
        data: { username: "evidencerange", passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    await ride("2025-03-01T07:00Z", "2025-03-01T08:05Z");
    // 23:30 UTC on 30 Sep is 1 October in Köln: in the span up to 01 Oct.
    await ride("2025-09-30T23:30Z", "2025-10-01T01:00Z");
    await ride("2025-11-01T07:00Z", "2025-11-01T08:05Z");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const get = (key: string, query: Record<string, string>) =>
    request(app).get(`/api/v1/evidence/metric/${key}`).query(query).set("Cookie", cookie);

  it("lists only the rides inside the span, on the station's calendar", async () => {
    const res = await get("railRideCount", {
      period: "range",
      from: "2025-01-01",
      to: "2025-10-01",
    });
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(2);
    expect(res.body.measure.scope.period).toEqual({
      kind: "range",
      from: "2025-01-01",
      to: "2025-10-01",
    });
    const year = await get("railRideCount", { period: "year", year: "2025" });
    expect(year.body.measure.value).toBe(3);
  });

  it("refuses a range where the measure does not honour one", async () => {
    expect(
      (await get("railOperatorsCount", { period: "range", from: "2025-01-01", to: "2025-10-01" }))
        .status
    ).toBe(400);
    expect(
      (await get("flightCount", { period: "range", from: "2025-01-01", to: "2025-10-01" })).status
    ).toBe(400);
  });

  it("validates the span", async () => {
    expect((await get("railRideCount", { period: "range", from: "2025-10-01" })).status).toBe(400);
    expect(
      (await get("railRideCount", { period: "range", from: "2025-10-02", to: "2025-10-01" })).status
    ).toBe(400);
    expect(
      (await get("railRideCount", { period: "allTime", from: "2025-10-01", to: "2025-10-02" }))
        .status
    ).toBe(400);
  });
});
