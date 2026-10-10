import { prisma } from "../../../db";
import type { EvidenceScope } from "../../../shared/evidence";
import { calculateRentalAchievementStats } from "../../../utils/rentalAchievements";
import { rentalStatsFor } from "../../rental/rentalStats";
import { resolveMetricEvidence } from "../metricEvidence";
import { assertDistinctInvariant, assertSumInvariant } from "./invariants";

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

  it("opens the rentals behind every further tile of the tab (forgejo#262)", async () => {
    await add({
      provider: "Europcar",
      broker: "Check24",
      pickupTime: new Date("2026-03-01T09:00:00Z"),
      returnTime: new Date("2026-03-04T09:00:00Z"),
      price: 200,
      currency: "EUR",
      distanceKm: 300,
      distanceSource: "agreement",
      vehicleExample: "VW Golf oder ähnlich",
      vehicleDriven: "VW Golf",
    });
    const y2026: EvidenceScope = { period: { kind: "year", year: 2026 } };
    const tab = await rentalStatsFor(userId, 2026);
    const value = async (key: string, scope: EvidenceScope = y2026) =>
      (await resolve(key, scope)).measure.value;
    const distinct = async (key: string, scope: EvidenceScope = y2026) => {
      const res = await resolveMetricEvidence(userId, key, scope, PAGE);
      if (!res) throw new Error(`${key} is not served`);
      assertDistinctInvariant(res);
      return res;
    };

    expect(await value("rentalKmTotal")).toBe(tab.km.total);
    expect(await value("rentalCostedCount")).toBe(tab.costPerDay[0].rentals);
    expect(await value("rentalBrokeredCount")).toBe(tab.extra.brokered.viaBroker);
    expect(await value("rentalKmPerDaySampleCount")).toBe(tab.extra.kmPerDay.rentals);
    expect(await value("rentalCostPerKmSampleCount")).toBe(tab.extra.costPerKm[0].rentals);
    expect(await value("rentalVehicleComparedCount")).toBe(
      tab.extra.vehicles.promisedVsDriven.compared
    );
    expect((await distinct("rentalDrivenModelsCount")).measure.value).toBe(
      tab.extra.vehicles.distinctDriven
    );
    expect((await distinct("rentalNewProvidersCount")).measure.value).toBe(
      tab.extra.records.newProviders.length
    );
    expect(await value("rentalLongest")).toBe(tab.extra.records.longest?.days);
    expect(await value("rentalFarthest")).toBe(tab.extra.records.farthest?.km);

    // Lifetime: the odometer's 500 km and the agreement's 300 km are both known km.
    const lifetime = await rentalStatsFor(userId, null);
    expect(await value("rentalKmTotal", ALL)).toBe(800);
    expect(await value("rentalKmTotal", ALL)).toBe(lifetime.km.total);
    expect(await value("rentalFarthest", ALL)).toBe(500);
    expect(await value("rentalLongest", ALL)).toBe(lifetime.extra.records.longest?.days);
    const providers = await distinct("rentalNewProvidersCount", ALL);
    expect(providers.measure.value).toBe(2);
    expect(providers.entries.flatMap((e) => Object.values(e.creditLabels ?? {})).sort()).toEqual([
      "Europcar",
      "Sixt",
    ]);
  });

  it("abstains where nothing is known rather than answering 0", async () => {
    const y2025: EvidenceScope = { period: { kind: "year", year: 2025 } };
    expect((await resolve("rentalKmTotal", y2025)).measure.value).toBeNull();
    expect((await resolve("rentalFarthest", y2025)).measure.value).toBeNull();
  });

  // The rental tab's "So wird gezählt" says rental days are not added on top of
  // travel days. This is what holds it: the cross-domain population has no
  // rental member, so a rental adds no active day, no event and no country.
  it("adds no rental day, event or country to the cross-domain figures", async () => {
    const scope: EvidenceScope = {
      period: { kind: "allTime" },
      domains: ["rental"],
    };
    for (const key of [
      "crossDomainActiveDayCount",
      "crossDomainEventCount",
      "crossDomainCountryCount",
    ]) {
      const res = await resolveMetricEvidence(userId, key, scope, PAGE);
      expect(res?.measure.value).toBe(0);
      expect(res?.entries).toEqual([]);
    }
  });
});
