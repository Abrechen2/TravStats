/**
 * Days away counts coach rides and ferry crossings: a completed one used to
 * add no day to "Tage unterwegs" although the cross-domain account already
 * read them. Days sit on the TERMINALS' calendars, and only when the domain
 * is switched on for the user.
 */
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const USERNAME = "summarydaysaway-busferry";

describe("GET /stats/summary — daysAway.bus / daysAway.ferry", () => {
  let userId: string;
  let cookie: string;

  const ride = (over: { status: string; departureTime: Date; arrivalTime: Date | null }) => ({
    userId,
    depStationName: "A",
    depLat: 35.68,
    depLon: 139.76,
    depTimezone: "Asia/Tokyo",
    arrStationName: "B",
    arrLat: 35.0,
    arrLon: 135.76,
    arrTimezone: "Asia/Tokyo",
    ...over,
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    // 21 May 07:30 in Tokyo is 20 May 22:30Z: the UTC date is a day early.
    await prisma.busJourney.createMany({
      data: [
        ride({
          status: "completed",
          departureTime: new Date("2024-05-20T22:30:00Z"),
          arrivalTime: new Date("2024-05-21T01:00:00Z"),
        }),
        ride({
          status: "scheduled",
          departureTime: new Date("2024-06-01T08:00:00Z"),
          arrivalTime: new Date("2024-06-01T10:00:00Z"),
        }),
      ],
    });
    await prisma.ferryJourney.createMany({
      data: [
        ride({
          status: "completed",
          departureTime: new Date("2024-08-10T08:00:00Z"),
          arrivalTime: new Date("2024-08-10T12:00:00Z"),
        }),
        ride({
          status: "scheduled",
          departureTime: new Date("2024-09-01T08:00:00Z"),
          arrivalTime: null,
        }),
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const setDomains = (enabledDomains: string[]) =>
    prisma.userSettings.upsert({
      where: { userId },
      create: { userId, enabledDomains, data: {} },
      update: { enabledDomains },
    });
  const daysAway = async (query: Record<string, unknown> = {}) =>
    (await request(app).get("/api/v1/stats/summary").query(query).set("Cookie", cookie).expect(200))
      .body.daysAway;

  it("counts a completed coach ride and ferry crossing on their terminals' calendars", async () => {
    await setDomains(["flight", "bus", "ferry"]);
    const out = await daysAway();
    expect(out.bus).toBe(1); // 21 May, not 20 + 21
    expect(out.ferry).toBe(1); // 10 Aug (Tokyo 17:00-21:00)
    expect(out.total).toBe(2);
  });

  it("adds no day for a domain that is switched off", async () => {
    await setDomains(["flight", "bus"]);
    const out = await daysAway();
    expect(out.bus).toBe(1);
    expect(out.ferry).toBe(0);
    expect(out.total).toBe(1);
    await setDomains(["flight"]);
    const none = await daysAway();
    expect([none.bus, none.ferry, none.total]).toEqual([0, 0, 0]);
  });

  it("clips to the year on the terminal's calendar", async () => {
    await setDomains(["flight", "bus", "ferry"]);
    const row = await prisma.busJourney.create({
      data: ride({
        status: "completed",
        departureTime: new Date("2024-12-31T22:30:00Z"),
        arrivalTime: new Date("2025-01-01T01:00:00Z"),
      }),
    });
    try {
      expect((await daysAway({ year: 2024 })).bus).toBe(1);
      expect((await daysAway({ year: 2025 })).bus).toBe(1);
    } finally {
      await prisma.busJourney.delete({ where: { id: row.id } });
    }
  });
});
