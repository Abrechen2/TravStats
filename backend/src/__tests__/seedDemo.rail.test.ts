import { describe, it, expect, afterAll } from "@jest/globals";

import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { RAIL_DISTANCE_SOURCES, RAIL_STATUSES, RAIL_TRAVEL_CLASSES } from "../schemas/rail";
import { createDemoRail, demoRideRow, demoRides } from "../seedDemo/seedRail";

/**
 * The demo train rides (rail spec, phase 2b). The seed writes with
 * `createMany`, which checks no enum — a status or class the app does not know
 * would sit in the demo database and break a filter or a label. So every value
 * is checked against the vocabulary the router itself validates with.
 */
describe("demo rail seed", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const rows = demoRides().map((ride) => demoRideRow("u", ride, now));

  it("uses only values the rail schemas accept", () => {
    for (const row of rows) {
      expect(RAIL_STATUSES).toContain(row.status);
      expect(RAIL_TRAVEL_CLASSES).toContain(row.travelClass);
      expect(RAIL_DISTANCE_SOURCES).toContain(row.distanceSource);
      expect(row.distanceKm).toBeGreaterThan(0);
    }
  });

  it("reads each ticket time on its own station's clock", () => {
    const night = rows.find((r) => r.trainNumber === "466")!;
    // 21:27 in Vienna in winter is 20:27 UTC; 08:20 in Zurich is 07:20 UTC.
    expect(night.departureTime.toISOString()).toBe("2024-12-31T20:27:00.000Z");
    expect(night.arrivalTime.toISOString()).toBe("2025-01-01T07:20:00.000Z");
  });

  it("keeps an upcoming ride scheduled and without a delay", () => {
    const upcoming = demoRides().map((ride) => demoRideRow("u", ride));
    const tgv = upcoming.find((r) => r.trainNumber === "6105")!;
    expect(tgv.status).toBe("scheduled");
    expect(tgv.delayMinutes).toBeNull();
    expect(rows.filter((r) => r.status === "completed")).toHaveLength(3);
  });

  describe("against the database", () => {
    let userId: string | null = null;
    afterAll(async () => {
      if (userId) await prisma.user.delete({ where: { id: userId } });
    });

    it("creates the rides once, switches the user half of the gate on, and is idempotent", async () => {
      userId = (
        await prisma.user.create({
          data: {
            username: `rail-demo-${Date.now()}`,
            passwordHash: await hashPassword("x-password"),
          },
        })
      ).id;
      await createDemoRail(userId);
      await createDemoRail(userId);
      expect(await prisma.railJourney.count({ where: { userId } })).toBe(demoRides().length);
      const settings = await prisma.userSettings.findUnique({ where: { userId } });
      expect(settings?.enabledDomains).toContain("rail");
    });
  });
});
