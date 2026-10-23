import { prisma } from "../../../db";
import { loadRailStats } from "../railStats";
import { loadDomainRecords } from "../../stats/domainRecords";
import { loadWrappedDomains } from "../../stats/wrappedDomains";
import { loadRailEnds } from "../../stats/railEvidenceLoader";
import { foldRailAchievementStats, loadRailBadgeRows } from "../../../utils/railAchievements";
import { loadCrossDomainPopulation } from "../../evidence/crossDomainPopulations";
import { loadCoveredRides } from "../../loyalty/coverage";
import { rideCountriesByTrip } from "../../../routes/trips/tripCountries";
import { tripMovementModes } from "../../../shared/tripMovement";
import { railPresence } from "../../../shared/tripSuggestionRules";

/**
 * The owner's rule (2026-10-23): a U-Bahn or tram ride the user kept is
 * stored, but no rail figure counts it. One train (Munich → Salzburg, 150 km)
 * and one tram ride made deliberately loud — 900 km, ending in Switzerland, so
 * it would win the longest-ride record and add a country if anything let it
 * through. Each family of rail aggregation is asked once.
 */
describe("a tram ride counts in no rail figure", () => {
  let userId: string;
  let tripId: string;
  let trainId: string;
  let tramId: string;

  const ride = (over: Record<string, unknown>) => ({
    userId,
    operator: "DB Fernverkehr",
    depStationName: "München Hbf",
    depLat: 48.140229,
    depLon: 11.558339,
    depCountry: "DE",
    depTimezone: "Europe/Berlin",
    arrStationName: "Salzburg Hbf",
    arrLat: 47.8128,
    arrLon: 13.0456,
    arrCountry: "AT",
    arrTimezone: "Europe/Vienna",
    departureTime: new Date("2025-03-01T08:00:00Z"),
    arrivalTime: new Date("2025-03-01T09:30:00Z"),
    depPrecision: "minute",
    arrPrecision: "minute",
    distanceKm: 150,
    distanceSource: "user",
    status: "completed",
    ...over,
  });

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `rail-transitmode-${Date.now()}`, passwordHash: "x" },
      })
    ).id;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "rail"], data: {} },
    });
    tripId = (await prisma.trip.create({ data: { userId, name: "Transit mode" } })).id;
    trainId = (
      await prisma.railJourney.create({
        data: ride({ tripId, trainCategory: "RJX", trainNumber: "61" }),
      })
    ).id;
    tramId = (
      await prisma.railJourney.create({
        data: ride({
          tripId,
          transitMode: "tram",
          trainCategory: "STR",
          trainNumber: "19",
          arrStationName: "Zürich, Central",
          arrCountry: "CH",
          arrTimezone: "Europe/Zurich",
          departureTime: new Date("2025-03-02T08:00:00Z"),
          arrivalTime: new Date("2025-03-02T08:20:00Z"),
          distanceKm: 900,
        }),
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("is stored as a tram ride", async () => {
    const stored = await prisma.railJourney.findUniqueOrThrow({ where: { id: tramId } });
    expect(stored.transitMode).toBe("tram");
    const train = await prisma.railJourney.findUniqueOrThrow({ where: { id: trainId } });
    expect(train.transitMode).toBe("rail");
  });

  it("rail statistics: rides, kilometres, countries, the longest ride", async () => {
    const stats = await loadRailStats(userId, null);
    expect(stats.journeys).toBe(1);
    expect(stats.distance.totalKm).toBe(150);
    expect(stats.countries.sort()).toEqual(["AT", "DE"]);
    expect(stats.longest?.id).toBe(trainId);
    expect((await loadRailStats(userId, 2025)).journeys).toBe(1);
  });

  it("records", async () => {
    const records = await loadDomainRecords(userId, new Set(["rail"]));
    expect(records.find((r) => r.domain === "rail")).toMatchObject({
      entryId: trainId,
      value: 150,
    });
  });

  it("the year in review", async () => {
    const wrapped = await loadWrappedDomains(userId);
    expect(wrapped.rail).toHaveLength(1);
  });

  it("visited countries and travel days (passport and country pages)", async () => {
    const ends = await loadRailEnds(userId);
    expect(new Set(ends.map((e) => e.rideId))).toEqual(new Set([trainId]));
    expect(ends.map((e) => e.country)).not.toContain("CH");
  });

  it("badges", async () => {
    const stats = foldRailAchievementStats(await loadRailBadgeRows(userId));
    expect(stats).toMatchObject({ railRidesCount: 1, railKm: 150, railCountries: 2 });
  });

  it("the cross-domain overview and its evidence", async () => {
    const population = await loadCrossDomainPopulation(userId, ["rail"]);
    expect(population.events.length).toBeGreaterThan(0);
    expect(population.countryRows.flatMap((r) => r.countries)).not.toContain("CH");
    expect(JSON.stringify(population)).not.toContain(tramId);
  });

  it("a rail loyalty card's coverage", async () => {
    expect((await loadCoveredRides(userId)).map((r) => r.id)).toEqual([trainId]);
  });

  it("a trip's countries", async () => {
    const countries = await rideCountriesByTrip([tripId]);
    expect(countries.get(tripId)).not.toContain("CH");
  });

  it("the modes a trip moved by — but it still says where the user was", () => {
    const tram = { status: "completed", transitMode: "tram" };
    const modes = tripMovementModes(
      { flights: [], cruises: [], railJourneys: [tram], busJourneys: [], startedRoadtrips: 0 },
      () => true
    );
    expect(modes.has("rail")).toBe(false);
    expect(railPresence(tram)).toBe("happened");
  });

  it("still lists the ride on its trip", async () => {
    const onTrip = await prisma.railJourney.findMany({ where: { tripId }, select: { id: true } });
    expect(onTrip.map((r) => r.id).sort()).toEqual([trainId, tramId].sort());
  });
});
