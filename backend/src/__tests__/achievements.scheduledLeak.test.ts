import { prisma } from '../db';
import { checkAndUpdateAchievements } from '../utils/achievements';

/**
 * Regression: scheduled flights must not contribute to "general" achievements
 * (flights_count, distance_km, countries, airports, airlines, continents,
 * aircraft_types, single_flight_distance, night/weekend, ocean_crossing,
 * arctic, equator, all_seasons, time_travel, etc.).
 *
 * The only achievements a single scheduled FRA→JFK flight is allowed to
 * unlock are scheduled-specific ones:
 *   - scheduled_count           (>= 1)
 *   - scheduled_continents      (>= 2 — Europe + North America)
 *   - scheduled_advance_days    (any threshold <= ~30)
 *   - scheduled_30d             (>= 1)
 *
 * If any other requirementType unlocks, scheduled flights are leaking into
 * the general achievement engine and we have a bug.
 */

const ALLOWED_SCHEDULED_REQUIREMENT_TYPES = new Set([
  "scheduled_count",
  "scheduled_continents",
  "scheduled_advance_days",
  "scheduled_30d",
]);

describe("Achievements — scheduled-flight leak regression", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `sched_leak_${Date.now()}`,
        passwordHash: "testhash",
      },
    });
    userId = user.id;

    // Make sure at least one general-purpose achievement exists in the DB —
    // otherwise the test can't fail even if a leak existed. We seed one of
    // each likely-leaking requirementType (idempotent via upsert by code).
    const seeds: Array<{
      code: string;
      name: string;
      description: string;
      requirementType: string;
      requirement: number;
      icon: string;
      category: string;
    }> = [
      {
        code: "TEST_LEAK_FLIGHTS_COUNT",
        name: "Leak: First Flight",
        description: "Counted toward general flights_count",
        requirementType: "flights_count",
        requirement: 1,
        icon: "test",
        category: "milestone",
      },
      {
        code: "TEST_LEAK_DISTANCE",
        name: "Leak: Some Distance",
        description: "Counted toward general distance_km",
        requirementType: "distance_km",
        requirement: 1,
        icon: "test",
        category: "milestone",
      },
      {
        code: "TEST_LEAK_COUNTRIES",
        name: "Leak: First Country",
        description: "Counted toward general countries",
        requirementType: "countries",
        requirement: 1,
        icon: "test",
        category: "geography",
      },
      {
        code: "TEST_LEAK_AIRLINES",
        name: "Leak: First Airline",
        description: "Counted toward general airlines",
        requirementType: "airlines",
        requirement: 1,
        icon: "test",
        category: "airlines",
      },
      {
        code: "TEST_LEAK_AIRPORTS",
        name: "Leak: First Airport",
        description: "Counted toward general airports",
        requirementType: "airports",
        requirement: 1,
        icon: "test",
        category: "geography",
      },
      {
        code: "TEST_LEAK_CONTINENTS",
        name: "Leak: First Continent",
        description: "Counted toward general continents",
        requirementType: "continents",
        requirement: 1,
        icon: "test",
        category: "geography",
      },
      {
        code: "TEST_LEAK_AIRCRAFT",
        name: "Leak: First Aircraft Type",
        description: "Counted toward general aircraft_types",
        requirementType: "aircraft_types",
        requirement: 1,
        icon: "test",
        category: "aircraft",
      },
      {
        code: "TEST_LEAK_SINGLE_DISTANCE",
        name: "Leak: Long Single Flight",
        description: "Counted toward general single_flight_distance",
        requirementType: "single_flight_distance",
        requirement: 1,
        icon: "test",
        category: "distance",
      },
      {
        code: "TEST_LEAK_OCEAN",
        name: "Leak: Ocean Crossing",
        description: "Counted toward ocean_crossing (>5000 km)",
        requirementType: "ocean_crossing",
        requirement: 1,
        icon: "test",
        category: "milestone",
      },
      {
        code: "TEST_LEAK_NIGHT",
        name: "Leak: Night Flight",
        description: "Counted toward night_flights",
        requirementType: "night_flights",
        requirement: 1,
        icon: "test",
        category: "time",
      },
      {
        code: "TEST_LEAK_WEEKEND",
        name: "Leak: Weekend Flight",
        description: "Counted toward weekend_flights",
        requirementType: "weekend_flights",
        requirement: 1,
        icon: "test",
        category: "time",
      },
    ];

    for (const seed of seeds) {
      await prisma.achievement.upsert({
        where: { code: seed.code },
        update: {},
        create: seed,
      });
    }
  });

  afterAll(async () => {
    await prisma.userAchievement.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    // Test seeds remain — they're idempotent and harmless for other tests
    await prisma.$disconnect();
  });

  it("does not unlock any general achievement from a single scheduled FRA→JFK flight", async () => {
    // FRA → JFK, ~6200 km (would unlock ocean_crossing if leaking),
    // departure ~30 days in the future (well clear of zombie cutoffs).
    // Use absolute date strings so the test is deterministic across reruns.
    await prisma.flight.create({
      data: {
        userId,
        airline: "Lufthansa",
        flightNumber: "LH400",
        depIata: "FRA",
        depLat: 50.0379,
        depLon: 8.5622,
        arrIata: "JFK",
        arrLat: 40.6413,
        arrLon: -73.7781,
        // 2027-06-15 is comfortably in the future relative to the
        // checked-in commit date and matches the user's "~30 days
        // in advance" intent without coupling to Date.now().
        departureTime: new Date("2027-06-15T10:00:00Z"),
        arrivalTime: new Date("2027-06-15T18:30:00Z"),
        status: "scheduled",
        aircraft: "Boeing 747-8",
        seatClass: "business",
      },
    });

    const newlyUnlocked = await checkAndUpdateAchievements(userId);

    // Build a friendly diagnostic message for any leak that slips through.
    const leaked = newlyUnlocked.filter(
      (ua) =>
        !ALLOWED_SCHEDULED_REQUIREMENT_TYPES.has(
          ua.achievement.requirementType,
        ),
    );

    if (leaked.length > 0) {
      const summary = leaked
        .map(
          (ua) =>
            `${ua.achievement.code} (${ua.achievement.requirementType}, req=${ua.achievement.requirement})`,
        )
        .join(", ");
      throw new Error(
        `Scheduled-flight leak detected — these non-scheduled achievements unlocked: ${summary}`,
      );
    }

    expect(leaked).toEqual([]);

    // Sanity check: scheduled-specific achievements are allowed (and expected
    // to fire if seeded). Don't fail the test if none are seeded — DB content
    // varies across environments — but if anything DID unlock it must be one
    // of the allowed scheduled requirementTypes.
    for (const ua of newlyUnlocked) {
      expect(ALLOWED_SCHEDULED_REQUIREMENT_TYPES.has(
        ua.achievement.requirementType,
      )).toBe(true);
    }
  });
});
