import { prisma } from "../../../db";
import type { EvidenceScope } from "../../../shared/evidence";
import { calculateRentalAchievementStats } from "../../../utils/rentalAchievements";
import { rentalStatsFor } from "../../rental/rentalStats";
import { resolveMetricEvidence } from "../metricEvidence";
import { assertSumInvariant } from "./invariants";

/**
 * forgejo#262 — the rental measures list the rentals behind the tab's tiles
 * and the rental badges, with the tab's and the badge's own figure.
 */
const USER = "rentalevidence";
const ALL: EvidenceScope = { period: { kind: "allTime" } };
const PAGE = { offset: 0, limit: 50 };
type Rental = Parameters<typeof prisma.rentalBooking.create>[0]["data"];

describe("rental evidence measures", () => {
  let userId: string;
  const add = (over: Partial<Rental>) =>
    prisma.rentalBooking.create({
      data: {
        userId,
        provider: "Sixt",
        pickupStationName: "Lisboa Aeroporto",
        pickupLat: 38.7742,
        pickupLon: -9.1342,
        pickupTimezone: "Europe/Lisbon",
        returnStationName: "Lisboa Aeroporto",
        returnLat: 38.7742,
        returnLon: -9.1342,
        returnTimezone: "Europe/Lisbon",
        pickupTime: new Date("2024-04-01T09:00:00Z"),
        returnTime: new Date("2024-04-05T09:00:00Z"),
        status: "completed",
        ...over,
      } as Rental,
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await add({ odometerOutKm: 100, odometerInKm: 600 });
    await add({
      pickupTime: new Date("2025-08-01T09:00:00Z"),
      returnTime: new Date("2025-08-02T09:00:00Z"),
      returnStationName: "Porto Aeroporto",
      returnLat: 41.2481,
      returnLon: -8.6814,
    });
    await add({ status: "cancelled" });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
  });

  const resolve = async (key: string, scope: EvidenceScope = ALL) => {
    const res = await resolveMetricEvidence(userId, key, scope, PAGE);
    if (!res) throw new Error(`${key} is not served`);
    assertSumInvariant(res, Math.round);
    return res;
  };

  it("lists the rentals behind each figure, with the tab's and the badge's own number", async () => {
    const tab = await rentalStatsFor(userId, null);
    const badge = await calculateRentalAchievementStats(userId);

    const count = await resolve("rentalCount");
    expect(count.measure.value).toBe(tab.rentals);
    expect(count.measure.value).toBe(badge.rentalCount);
    expect(count.entries[0]?.href).toMatch(/^\/rentals\//);

    const days = await resolve("rentalDaysTotal");
    expect(days.measure.value).toBe(tab.days);
    expect(days.measure.value).toBe(5);

    const oneWay = await resolve("rentalOneWayCount");
    expect(oneWay.measure.value).toBe(tab.oneWay);
    expect(oneWay.entries.map((e) => e.title.text)).toEqual([
      "Sixt · Lisboa Aeroporto → Porto Aeroporto",
    ]);

    const odometer = await resolve("rentalOdometerDocumentedCount");
    expect(odometer.measure.value).toBe(badge.rentalOdometerDocumented);
    expect(odometer.measure.value).toBe(tab.extra.odometerDocumented);
  });

  it("cuts a year by the pickup's day, as the tab does", async () => {
    const year = await resolve("rentalCount", { period: { kind: "year", year: 2025 } });
    expect(year.measure.value).toBe((await rentalStatsFor(userId, 2025)).rentals);
    expect(year.measure.value).toBe(1);
  });
});
