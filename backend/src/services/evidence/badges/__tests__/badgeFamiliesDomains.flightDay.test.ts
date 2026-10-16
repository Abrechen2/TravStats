import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../../db";
import { loadBadgeFamily } from "../badgeFamiliesDomains";

/**
 * A flight badge's proof row is dated on the day the flight LEFT at its
 * departure airport (`flightDateOf`, forgejo#273), like every other flight
 * evidence row. The flight-insight family sliced the UTC instant instead, so
 * a Tokyo departure at 07:30 local showed under the day before.
 */
const USER = "badge-family-flight-day";

describe("flight-insight badge evidence dates", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await prisma.flight.create({
      data: {
        userId,
        flightNumber: "NH217",
        depIata: "HND",
        arrIata: "MUC",
        depLat: 35.55,
        depLon: 139.78,
        arrLat: 48.35,
        arrLon: 11.79,
        // 07:30 on 2 March in Tokyo.
        departureTime: new Date("2024-03-01T22:30:00Z"),
        depTimezone: "Asia/Tokyo",
        status: "flown",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("dates the row on the departure airport's day", async () => {
    const family = await loadBadgeFamily(
      userId,
      { requirementType: "flight_new_airports_year", requirement: 1 },
      null
    );
    if (!family) throw new Error("flight_new_airports_year has no family");
    expect(family.rows.map((row) => family.entryOf(row).date)).toEqual([
      { value: "2024-03-02", precision: "day" },
    ]);
  });
});
