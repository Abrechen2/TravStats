import { prisma } from "../../db";
import { achievements } from "../../data/achievements";
import { loadDomainAchievementChecks } from "../domainAchievementChecks";
import {
  FERRY_REQUIREMENT_TYPES,
  calculateFerryAchievementStats,
  checkFerryAchievement,
  foldFerryAchievementStats,
} from "../ferryAchievements";
import { BADGE_WITHOUT_EVIDENCE, badgeEvidenceKey } from "../../shared/badgeEvidence";

/**
 * Ferry was the one transport domain without badges: a crossing counted
 * nowhere on the achievements page. The ferry badges count completed
 * crossings, an overnight crossing only by its clocks (the night rule bus and
 * rail use), and ports by their stable identity (two records of one port a few
 * hundred metres apart are one port).
 */
const USER = "ferrybadges";
type Crossing = Parameters<typeof prisma.ferryJourney.create>[0]["data"];

const PORTS = [
  { name: "Kiel", lat: 54.3233, lon: 10.1394, tz: "Europe/Berlin" },
  { name: "Göteborg", lat: 57.7089, lon: 11.9746, tz: "Europe/Stockholm" },
  { name: "Kiel", lat: 54.3172, lon: 10.1405, tz: "Europe/Berlin" }, // same port, other pin
  { name: "Frederikshavn", lat: 57.4407, lon: 10.5361, tz: "Europe/Copenhagen" },
];

describe("ferry achievements", () => {
  let userId: string;
  const add = (from: number, to: number, dep: string, arr: string, over: Partial<Crossing> = {}) =>
    prisma.ferryJourney.create({
      data: {
        userId,
        depStationName: PORTS[from].name,
        depLat: PORTS[from].lat,
        depLon: PORTS[from].lon,
        depTimezone: PORTS[from].tz,
        arrStationName: PORTS[to].name,
        arrLat: PORTS[to].lat,
        arrLon: PORTS[to].lon,
        arrTimezone: PORTS[to].tz,
        departureTime: new Date(dep),
        arrivalTime: new Date(arr),
        depPrecision: "minute",
        arrPrecision: "minute",
        status: "completed",
        ...over,
      } as Crossing,
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    // Overnight Kiel -> Göteborg, 14.5 h on board.
    await add(0, 1, "2025-06-10T16:45Z", "2025-06-11T07:15Z");
    // Göteborg -> Frederikshavn by day.
    await add(1, 3, "2025-06-12T08:00Z", "2025-06-12T11:30Z");
    // Back into Kiel at another pin of the same port — one port, not two.
    await add(3, 2, "2025-06-13T08:00Z", "2025-06-13T09:00Z", { arrPrecision: "day" });
    // A cancelled crossing counts nowhere.
    await add(0, 3, "2025-06-20T08:00Z", "2025-06-20T20:00Z", { status: "cancelled" });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
  });

  it("measures completed crossings, the overnight one and three distinct ports", async () => {
    const stats = await calculateFerryAchievementStats(userId);
    expect(stats).toEqual({
      ferryCrossingsCount: 3,
      ferryNightCrossings: 1,
      ferryPorts: 3,
      ferryKm: 0,
      ferryCountries: 0,
      ferryOperators: 0,
      ferryVehicleCrossings: 0,
    });
    expect(
      checkFerryAchievement({ requirementType: "ferry_night_crossings", requirement: 1 }, stats)
    ).toEqual({ isUnlocked: true, progress: 1 });
    expect(
      checkFerryAchievement({ requirementType: "bus_count", requirement: 1 }, stats)
    ).toBeNull();
  });

  // forgejo#405: the depth rungs. A vehicle is a type or a registration, nothing else.
  it("measures kilometres, countries, lines and a vehicle aboard from the crossing's own record", () => {
    const crossing = (over: object) =>
      ({
        id: "x",
        depStationName: "A",
        depLat: 1,
        depLon: 1,
        arrStationName: "B",
        arrLat: 2,
        arrLon: 2,
        departureTime: new Date("2025-01-01T08:00:00Z"),
        arrivalTime: null,
        depTimezone: null,
        arrTimezone: null,
        depPrecision: null,
        arrPrecision: null,
        operator: null,
        depCountry: null,
        arrCountry: null,
        distanceKm: null,
        vehicleType: null,
        vehicleRegistration: null,
        ...over,
      }) as never;
    const stats = foldFerryAchievementStats([
      crossing({ operator: "Stena Line", depCountry: "DE", arrCountry: "SE", distanceKm: 452.4 }),
      crossing({ operator: "stena  line", depCountry: "SE", arrCountry: "DK", vehicleType: "Pkw" }),
      crossing({ operator: "TT-Line", vehicleRegistration: " " }),
    ]);
    expect(stats).toMatchObject({
      ferryKm: 452.4,
      ferryCountries: 3,
      ferryOperators: 2,
      // Whitespace is no registration; one crossing names a vehicle type.
      ferryVehicleCrossings: 1,
    });
    expect(
      checkFerryAchievement({ requirementType: "ferry_km", requirement: 1000 }, stats)
    ).toEqual({ isUnlocked: false, progress: 452 });
    expect(
      checkFerryAchievement({ requirementType: "ferry_vehicle", requirement: 1 }, stats)
    ).toEqual({ isUnlocked: true, progress: 1 });
  });

  it("seeds ferry badges whose rules the ferry check answers, each with an evidence answer", () => {
    const seeds = achievements.filter((a) => a.domain === "ferry");
    expect(seeds.length).toBeGreaterThan(0);
    for (const a of seeds) {
      expect(FERRY_REQUIREMENT_TYPES).toContain(a.requirementType);
      expect(
        badgeEvidenceKey(a.requirementType) !== null || a.requirementType in BADGE_WITHOUT_EVIDENCE
      ).toBe(true);
    }
  });

  it("is registered with the badge planner", async () => {
    const { checks } = await loadDomainAchievementChecks(userId);
    const answers = checks.map((check) =>
      check({ requirementType: "ferry_count", requirement: 1 } as Parameters<typeof check>[0])
    );
    expect(answers).toContainEqual({ isUnlocked: true, progress: 3 });
  });
});
