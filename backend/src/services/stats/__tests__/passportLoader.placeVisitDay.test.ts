import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../db";
import { loadPassport } from "../passportLoader";

/**
 * A place visit is dated on the PLACE's calendar (ADR 0002 D4): its UTC
 * instant read in the zone stored with it, as `placeCounting.visitYear` does.
 * The passport read the legacy `visitedAt`, a mixed column that may hold the
 * instant itself, so a New Year's morning in Tokyo counted for the old year.
 */
const USER = "passport-place-visit-local-day";

describe("loadPassport — a place visit's year is the place's local year", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    const place = await prisma.place.create({
      data: {
        userId,
        name: "Meiji Jingu",
        lat: 35.676,
        lon: 139.699,
        isoCountryCode: "JP",
        visited: true,
      },
    });
    // 08:30 on 1 January 2025 in Tokyo.
    const instant = new Date("2024-12-31T23:30:00Z");
    await prisma.placeVisit.create({
      data: {
        placeId: place.id,
        userId,
        visitedAt: instant,
        visitedAtUtc: instant,
        visitedZone: "Asia/Tokyo",
        visitedPrecision: "minute",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("files the visit under 2025", async () => {
    const jp = (await loadPassport(userId)).countries.find((c) => c.code === "JP");
    expect(jp).toMatchObject({ firstYear: 2025, lastYear: 2025 });
  });
});
