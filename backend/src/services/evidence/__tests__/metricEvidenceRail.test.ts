import { prisma } from "../../../db";
import type { EvidenceScope } from "../../../shared/evidence";
import { calculateRailAchievementStats } from "../../../utils/railAchievements";
import { resolveMetricEvidence } from "../metricEvidence";
import { assertDistinctInvariant, assertSumInvariant } from "./invariants";

/**
 * The rail measures list the rides behind a rail badge and a rail-tab figure.
 * The population guard: each measure's value must equal the badge measure
 * `calculateRailAchievementStats` computes for the same account — the number
 * the achievements page shows as progress.
 */

const USER = "railevidence";
const ALL: EvidenceScope = { period: { kind: "allTime" } };
const PAGE = { offset: 0, limit: 50 };

type Ride = Parameters<typeof prisma.railJourney.create>[0]["data"];

describe("rail evidence measures", () => {
  let userId: string;

  const add = (over: Partial<Ride>) =>
    prisma.railJourney.create({
      data: {
        userId,
        depStationName: "Frankfurt (Main) Hbf",
        depLat: 50.107,
        depLon: 8.663,
        depCountry: "DE",
        depTimezone: "Europe/Berlin",
        arrStationName: "Basel SBB",
        arrLat: 47.547,
        arrLon: 7.589,
        arrCountry: "CH",
        arrTimezone: "Europe/Zurich",
        departureTime: new Date("2024-06-01T08:00:00Z"),
        arrivalTime: new Date("2024-06-01T11:00:00Z"),
        status: "completed",
        ...over,
      } as Ride,
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await add({ operator: "DB Fernverkehr", trainCategory: "ICE", distanceKm: 262.4 });
    await add({
      operator: "ÖBB",
      trainCategory: "NJ",
      arrStationName: "Wien Hbf",
      arrCountry: "AT",
      arrTimezone: "Europe/Vienna",
      departureTime: new Date("2025-02-01T20:00:00Z"),
      arrivalTime: new Date("2025-02-02T07:00:00Z"),
      distanceKm: 600.3,
    });
    await add({ operator: "SBB", trainCategory: "IR", distanceKm: null, arrCountry: "DE" });
    await add({ status: "cancelled", trainCategory: "TGV", distanceKm: 500, operator: "SNCF" });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
  });

  const resolve = async (key: string, scope: EvidenceScope = ALL) => {
    const res = await resolveMetricEvidence(userId, key, scope, PAGE);
    if (!res) throw new Error(`${key} is not served`);
    return res;
  };

  it("lists exactly the rides behind each badge measure, with the badge's own figure", async () => {
    const badge = await calculateRailAchievementStats(userId);

    const rides = await resolve("railRideCount");
    assertSumInvariant(rides, Math.round);
    expect(rides.measure.value).toBe(badge.railRidesCount);
    expect(rides.entries).toHaveLength(3); // the cancelled ride is never listed

    const km = await resolve("railDistanceKmTotal");
    assertSumInvariant(km, Math.round);
    expect(km.measure.value).toBe(Math.round(badge.railKm));
    expect(km.entries).toHaveLength(2); // a ride without a distance measured nothing

    const countries = await resolve("railCountriesCount");
    assertDistinctInvariant(countries);
    expect(countries.measure.value).toBe(badge.railCountries);

    const operators = await resolve("railOperatorsCount");
    assertDistinctInvariant(operators);
    expect(operators.measure.value).toBe(badge.railOperators);
    const obb = operators.entries.find((e) => e.credits?.includes("öbb"));
    expect(obb?.creditLabels).toEqual({ öbb: "ÖBB" });

    const night = await resolve("railNightTrainCount");
    expect(night.measure.value).toBe(badge.railNightTrains);
    expect(night.entries.map((e) => e.title.text)).toEqual([
      "NJ · Frankfurt (Main) Hbf → Wien Hbf",
    ]);

    const fast = await resolve("railHighSpeedRideCount");
    expect(fast.measure.value).toBe(badge.railHighSpeedRides);

    const border = await resolve("railCrossBorderRideCount");
    expect(border.measure.value).toBe(badge.railCrossBorderRides);
    expect(border.entries).toHaveLength(2);
  });

  it("cuts a year by the day the ride left, as the rail tab does", async () => {
    const rides2025 = await resolve("railRideCount", { period: { kind: "year", year: 2025 } });
    expect(rides2025.measure.value).toBe(1);
    expect(rides2025.entries[0]?.href).toMatch(/^\/rail\//);
  });
});
