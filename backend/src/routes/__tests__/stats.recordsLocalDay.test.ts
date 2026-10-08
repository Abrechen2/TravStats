import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";

/**
 * Forgejo #255, end to end: `/stats/records` reads the busiest day on the
 * DEPARTURE AIRPORT'S calendar. Two NRT -> KIX departures at 23:30Z on 1 Sep and
 * 01:30Z on 2 Sep are both on 2 Sep in Tokyo — the record must say two flights
 * on 2026-09-02, not one flight each on two days.
 */
describe("GET /stats/records — busiest day on the airport's local day", () => {
  let userId: string;
  let authCookie: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { username: `records-${Date.now()}-${Math.random()}`, passwordHash: "x" },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(userId)}`;
  });

  afterEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function flyFromTokyo(departure: string): Promise<void> {
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
        departureTime: new Date(departure),
        arrivalTime: new Date(new Date(departure).getTime() + 80 * 60_000),
      },
    });
  }

  it("joins two departures either side of UTC midnight that share a Tokyo day", async () => {
    await flyFromTokyo("2026-09-01T23:30:00Z");
    await flyFromTokyo("2026-09-02T01:30:00Z");

    const res = await request(app).get("/api/v1/stats/records").set("Cookie", authCookie);

    expect(res.status).toBe(200);
    const busiest = res.body.data.records.find((r: { id: string }) => r.id === "busiest-day");
    expect(busiest.value).toBe(2);
    expect(busiest.date).toBe("2026-09-02");
  });
});
