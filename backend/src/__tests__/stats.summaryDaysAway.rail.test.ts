/**
 * Days away counts train rides (stats-coverage remainder, 2026-09-26): a
 * completed ride used to add no day to "Tage unterwegs", so a week spent on
 * trains read as a week at home. A ride's days are read on its STATIONS'
 * calendars, and only when the rail domain is switched on for the user.
 */
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import type { Prisma } from "../prisma";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const USERNAME = "summarydaysaway-rail";

describe("GET /stats/summary — daysAway.rail", () => {
  let userId: string;
  let cookie: string;

  const ride = (
    over: Pick<Prisma.RailJourneyUncheckedCreateInput, "departureTime" | "status"> &
      Partial<Prisma.RailJourneyUncheckedCreateInput>
  ): Prisma.RailJourneyUncheckedCreateInput => ({
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
    await prisma.railJourney.createMany({
      data: [
        // 21 May 07:30 in Tokyo is 20 May 22:30Z: the UTC date is a day early.
        ride({
          status: "completed",
          departureTime: new Date("2024-05-20T22:30:00Z"),
          arrivalTime: new Date("2024-05-21T01:00:00Z"),
        }),
        // Not completed: no day.
        ride({
          status: "scheduled",
          departureTime: new Date("2024-06-01T08:00:00Z"),
          arrivalTime: new Date("2024-06-01T10:00:00Z"),
        }),
        // A tram ride is not a train ride: no day.
        ride({
          status: "completed",
          transitMode: "tram",
          departureTime: new Date("2024-07-01T08:00:00Z"),
          arrivalTime: new Date("2024-07-01T09:00:00Z"),
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

  it("counts a completed train ride on its stations' calendar, once", async () => {
    await setDomains(["flight", "rail"]);
    const out = await daysAway();
    expect(out.rail).toBe(1); // 21 May, not 20 + 21
    expect(out.total).toBe(1);
  });

  it("adds no day while the rail domain is switched off", async () => {
    await setDomains(["flight"]);
    const out = await daysAway();
    expect(out.rail).toBe(0);
    expect(out.total).toBe(0);
  });

  it("clips a ride to the year on its station's calendar", async () => {
    await setDomains(["flight", "rail"]);
    // A 1 January morning departure in Tokyo is still 31 December in UTC.
    const row = await prisma.railJourney.create({
      data: ride({
        status: "completed",
        departureTime: new Date("2024-12-31T22:30:00Z"),
        arrivalTime: new Date("2025-01-01T01:00:00Z"),
      }),
    });
    try {
      expect((await daysAway({ year: 2024 })).rail).toBe(1); // 21 May only
      expect((await daysAway({ year: 2025 })).rail).toBe(1); // 1 Jan only
    } finally {
      await prisma.railJourney.delete({ where: { id: row.id } });
    }
  });
});
