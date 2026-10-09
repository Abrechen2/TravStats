import { prisma } from "../../db";
import { achievements } from "../../data/achievements";
import type { EvidenceScope } from "../../shared/evidence";
import { loadBusStats } from "../../services/bus/busStats";
import { resolveMetricEvidence } from "../../services/evidence/metricEvidence";
import {
  assertDistinctInvariant,
  assertSumInvariant,
} from "../../services/evidence/__tests__/invariants";
import {
  BUS_REQUIREMENT_TYPES,
  calculateBusAchievementStats,
  checkBusAchievement,
} from "../busAchievements";

/**
 * forgejo#263 — the bus badges count completed rides, a night bus only by its
 * clocks, and terminals by their stable identity; the evidence lists the rides
 * behind each, with the tab's and the badge's own figure.
 */
const USER = "busbadges";
const ALL: EvidenceScope = { period: { kind: "allTime" } };
const PAGE = { offset: 0, limit: 50 };
type Ride = Parameters<typeof prisma.busJourney.create>[0]["data"];

const STOPS = [
  { name: "ZOB", lat: 53.5527, lon: 10.0102, cc: "DE" }, // Hamburg
  { name: "ZOB", lat: 52.5073, lon: 13.2797, cc: "DE" }, // Berlin — same name, other city
  { name: "Florenc", lat: 50.0897, lon: 14.4397, cc: "CZ" },
];

describe("bus achievements", () => {
  let userId: string;
  const add = (from: number, to: number, dep: string, arr: string, over: Partial<Ride> = {}) =>
    prisma.busJourney.create({
      data: {
        userId,
        depStationName: STOPS[from].name,
        depLat: STOPS[from].lat,
        depLon: STOPS[from].lon,
        depCountry: STOPS[from].cc,
        depTimezone: "Europe/Berlin",
        arrStationName: STOPS[to].name,
        arrLat: STOPS[to].lat,
        arrLon: STOPS[to].lon,
        arrCountry: STOPS[to].cc,
        arrTimezone: "Europe/Berlin",
        departureTime: new Date(dep),
        arrivalTime: new Date(arr),
        depPrecision: "minute",
        arrPrecision: "minute",
        status: "completed",
        ...over,
      } as Ride,
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await add(0, 1, "2025-01-10T07:00Z", "2025-01-10T10:00Z", { distanceKm: 255 });
    await add(1, 2, "2025-01-11T21:00Z", "2025-01-12T05:00Z", { distanceKm: 280 });
    await add(2, 0, "2025-01-20T07:00Z", "2025-01-20T17:00Z", { status: "cancelled" });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
  });

  it("measures completed rides, the night bus and three terminals of which two share a name", async () => {
    const stats = await calculateBusAchievementStats(userId);
    expect(stats).toEqual({ busRidesCount: 2, busNightRides: 1, busTerminals: 3 });
    expect(
      checkBusAchievement({ requirementType: "bus_night_rides", requirement: 1 }, stats)
    ).toEqual({ isUnlocked: true, progress: 1 });
    expect(
      checkBusAchievement({ requirementType: "rail_count", requirement: 1 }, stats)
    ).toBeNull();
    const seeds = achievements.filter((a) => a.domain === "bus");
    expect(seeds.map((a) => a.code).sort()).toEqual(["BUS_FIRST", "BUS_NIGHT", "BUS_TERMINALS_10"]);
    for (const a of seeds) expect(BUS_REQUIREMENT_TYPES).toContain(a.requirementType);
  });

  it("lists the rides behind the tab's and the badges' figures", async () => {
    const tab = await loadBusStats(userId, null);
    const badge = await calculateBusAchievementStats(userId);
    const resolve = async (key: string) => {
      const res = await resolveMetricEvidence(userId, key, ALL, PAGE);
      if (!res) throw new Error(`${key} is not served`);
      return res;
    };
    const rides = await resolve("busRideCount");
    assertSumInvariant(rides, Math.round);
    expect(rides.measure.value).toBe(tab.rides);
    expect(rides.entries[0]?.href).toMatch(/^\/bus\//);

    const km = await resolve("busDistanceKmTotal");
    assertSumInvariant(km, Math.round);
    expect(km.measure.value).toBe(tab.distance.totalKm);

    const night = await resolve("busNightRideCount");
    expect(night.measure.value).toBe(badge.busNightRides);

    const terminals = await resolve("busTerminalsCount");
    assertDistinctInvariant(terminals);
    expect(terminals.measure.value).toBe(tab.terminalsVisited);
    expect(terminals.measure.value).toBe(badge.busTerminals);

    const countries = await resolve("busCountriesCount");
    assertDistinctInvariant(countries);
    expect(countries.measure.value).toBe(tab.countries.length);
  });
});
