import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `?year=&month=` on the bus, ferry, rental and cruise lists (the statistics year cards'
 * month detail links them). Each list gets one entry INSIDE March 2024 and one just OUTSIDE it,
 * and the pair is chosen so UTC and the local clock disagree: the "inside" one is already March
 * on the departure terminal's clock though it is still 29 February in UTC (Tokyo), the "outside"
 * one is March in UTC but still 29 February locally (New York). A filter on the UTC instant
 * would get both wrong.
 */
describe("?month= on the logbook lists", () => {
  const stamp = Date.now();
  let userId: string;
  const cookie = (): string => `auth_token=${generateToken(userId)}`;
  const TOKYO_MARCH = new Date("2024-02-29T15:30:00Z"); // 1 March 00:30 in Tokyo
  const NEW_YORK_FEB = new Date("2024-03-01T02:00:00Z"); // 29 February 21:00 in New York

  const stops = {
    depStationName: "A",
    depLat: 35.68,
    depLon: 139.76,
    arrStationName: "B",
    arrLat: 35.0,
    arrLon: 135.7,
  };

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `month-lists-${stamp}`, passwordHash: await hashPassword("pw123456") },
      })
    ).id;
    for (const [departureTime, depTimezone] of [
      [TOKYO_MARCH, "Asia/Tokyo"],
      [NEW_YORK_FEB, "America/New_York"],
    ] as const) {
      await prisma.busJourney.create({
        data: { userId, ...stops, status: "completed", departureTime, depTimezone },
      });
      await prisma.ferryJourney.create({
        data: { userId, ...stops, status: "completed", departureTime, depTimezone },
      });
    }
    for (const [pickupTime, pickupTimezone] of [
      [TOKYO_MARCH, "Asia/Tokyo"],
      [NEW_YORK_FEB, "America/New_York"],
    ] as const) {
      await prisma.rentalBooking.create({
        data: {
          userId,
          provider: "Sixt",
          pickupStationName: "A",
          pickupLat: 35.68,
          pickupLon: 139.76,
          pickupTimezone,
          pickupTime,
          returnStationName: "A",
          returnLat: 35.68,
          returnLon: 139.76,
          returnTimezone: pickupTimezone,
          returnTime: new Date(pickupTime.getTime() + 2 * 86_400_000),
          status: "completed",
        },
      });
    }
    // Cruises carry a calendar day at UTC midnight: 1 March is in, 29 February is out.
    for (const startDate of ["2024-03-01", "2024-02-29"]) {
      await prisma.cruise.create({
        data: {
          userId,
          shipNameOverride: "Test Ship",
          startDate: new Date(`${startDate}T00:00:00Z`),
          endDate: new Date("2024-03-09T00:00:00Z"),
          status: "completed",
        },
      });
    }
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const count = async (path: string, query: string): Promise<number> => {
    const res = await request(app)
      .get(`${path}?${query}&limit=50`)
      .set("Cookie", cookie())
      .expect(200);
    const rows = Array.isArray(res.body) ? res.body : (res.body.data ?? res.body.items ?? []);
    return Array.isArray(rows) ? rows.length : (rows.items?.length ?? -1);
  };

  it.each(["/api/v1/bus", "/api/v1/ferry", "/api/v1/rentals"])(
    "%s: keeps the ride that is March on its own clock and drops the one that is only March in UTC",
    async (path) => {
      expect(await count(path, "year=2024&month=3")).toBe(1);
      expect(await count(path, "year=2024&month=2")).toBe(1);
      expect(await count(path, "year=2024")).toBe(2);
      expect(await count(path, "year=2024&month=7")).toBe(0);
    }
  );

  it("/api/v1/cruises: month cuts at the sailing's start day", async () => {
    expect(await count("/api/v1/cruises", "year=2024&month=3")).toBe(1);
    expect(await count("/api/v1/cruises", "year=2024&month=2")).toBe(1);
    expect(await count("/api/v1/cruises", "year=2024&month=7")).toBe(0);
  });
});
