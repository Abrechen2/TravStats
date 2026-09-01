// POI requirement-type dispatch for `checkAchievement`.
//
// The invariant that matters most here is the one the lodging suite states for
// its own part: every `requirementType` in `seedsPartG` MUST resolve to real
// logic. A missing case falls through to `default` (progress 0, never
// unlocked), and the badge is then simply unreachable — silently, forever.
//
// POI adds a second one. Its checklist badges do NOT use a plain case: the list
// key rides inside the requirement type (`curated_list_ticked:<key>`). So the
// test has to prove both that the prefix is honoured AND that two checklists
// report SEPARATE progress — a single shared maximum would make every wonders
// badge show the same number, which is exactly what the per-list map exists to
// prevent.
import type { Achievement } from "@prisma/client";
import { checkAchievement } from "../achievementChecks";
import { calculateUserStats, type UserStats } from "../achievementStats";
import { seedsPartG } from "../../data/achievementSeeds/partG";
import { seedsPartH } from "../../data/achievementSeeds/partH";
import { achievements } from "../../data/achievements";

jest.mock("../../services/airportCache", () => ({
  getCachedAirports: jest.fn(async () => new Map()),
}));

function fakeAchievement(overrides: Partial<Achievement>): Achievement {
  return {
    id: "test-id",
    code: "TEST_CODE",
    name: "Test",
    description: "Test",
    category: "collector",
    domain: "poi",
    icon: "📍",
    tier: "bronze",
    requirement: 1,
    requirementType: "places_count",
    points: 10,
    isHidden: false,
    createdAt: new Date(),
    ...overrides,
  } as Achievement;
}

async function baseStats(): Promise<UserStats> {
  return calculateUserStats([]);
}

describe("checkAchievement — POI requirement types", () => {
  it("evaluates places_count against UserStats.placesCount", async () => {
    const stats: UserStats = { ...(await baseStats()), placesCount: 12 };
    const result = checkAchievement(
      fakeAchievement({ requirementType: "places_count", requirement: 10 }),
      stats,
      []
    );
    expect(result).toEqual({ isUnlocked: true, progress: 12 });
  });

  it("evaluates place_countries against the SET's size", async () => {
    const stats: UserStats = {
      ...(await baseStats()),
      placeCountries: new Set(["IT", "JP", "PE"]),
    };
    const result = checkAchievement(
      fakeAchievement({ requirementType: "place_countries", requirement: 10 }),
      stats,
      []
    );
    expect(result).toEqual({ isUnlocked: false, progress: 3 });
  });

  it("evaluates places_in_category against the biggest single category", async () => {
    const stats: UserStats = { ...(await baseStats()), placesInCategoryMax: 25 };
    const result = checkAchievement(
      fakeAchievement({ requirementType: "places_in_category", requirement: 25 }),
      stats,
      []
    );
    expect(result.isUnlocked).toBe(true);
  });

  it("evaluates place_visits_count separately from places_count", async () => {
    // One McDonald's, three visits: the badge about visits must see three.
    const stats: UserStats = { ...(await baseStats()), placesCount: 1, placeVisitsCount: 3 };
    expect(
      checkAchievement(
        fakeAchievement({ requirementType: "place_visits_count", requirement: 3 }),
        stats,
        []
      )
    ).toEqual({ isUnlocked: true, progress: 3 });
  });

  describe("curated_list_ticked:<key>", () => {
    const stats = async (): Promise<UserStats> => ({
      ...(await baseStats()),
      curatedTickedByList: new Map([
        ["world-wonders-new7", 7],
        ["world-wonders-ancient", 2],
      ]),
    });

    it("reads the key out of the requirement type", async () => {
      const result = checkAchievement(
        fakeAchievement({
          requirementType: "curated_list_ticked:world-wonders-new7",
          requirement: 7,
        }),
        await stats(),
        []
      );
      expect(result).toEqual({ isUnlocked: true, progress: 7 });
    });

    it("keeps two checklists' progress apart", async () => {
      const result = checkAchievement(
        fakeAchievement({
          requirementType: "curated_list_ticked:world-wonders-ancient",
          requirement: 7,
        }),
        await stats(),
        []
      );
      expect(result).toEqual({ isUnlocked: false, progress: 2 });
    });

    it("reports 0 for a key nobody has ticked — never a crash, never a default", async () => {
      const result = checkAchievement(
        fakeAchievement({
          requirementType: "curated_list_ticked:not-shipped-yet",
          requirement: 7,
        }),
        await stats(),
        []
      );
      expect(result).toEqual({ isUnlocked: false, progress: 0 });
    });
  });

  it("gives every POI requirement type real logic", async () => {
    const stats: UserStats = {
      ...(await baseStats()),
      placesCount: 999,
      placeVisitsCount: 999,
      placesInCategoryMax: 999,
      // Comfortably past the highest country requirement in the part, so a
      // failure here means a missing case rather than a short fixture.
      placeCountries: new Set(
        Array.from({ length: 40 }, (_, i) => `C${String(i).padStart(2, "0")}`)
      ),
      // Derived from the seeds rather than listed by hand. A hand-kept map is a
      // SHORT FIXTURE, and a short fixture fails this test in the same way a
      // missing case does — which is the one thing the assertion below promises
      // it does not do. Shipping `museum-warships` proved it: the badge existed,
      // the checker handled it generically, and only the fixture had not heard
      // of the list.
      curatedTickedByList: new Map(
        [...seedsPartG, ...seedsPartH]
          .map((s) => s.requirementType)
          .filter((rt) => rt.startsWith("curated_list_ticked:"))
          .map((rt) => [rt.slice("curated_list_ticked:".length), 10_000] as const)
      ),
      // Part H's measures, all comfortably past their highest requirement, so a
      // failure below means a missing case rather than a short fixture.
      placeCities: new Set(Array.from({ length: 80 }, (_, i) => `city-${i}`)),
      placeContinents: new Set([
        "Africa", "Antarctica", "Asia", "Europe",
        "North America", "Oceania", "South America",
      ]),
      placeCategoriesUnique: 8,
      placeSameRepeatMax: 999,
      placesInOneDayMax: 999,
      placeVisitStreakMax: 999,
      placeVisitsInYearMax: 999,
      placeCountriesInYearMax: 999,
      placeRatedVisits: 999,
      placeTripVisits: 999,
      placeNorthernLat: 78.2,
      placeSouthernLat: -77.8,
    };

    for (const seed of [...seedsPartG, ...seedsPartH]) {
      const result = checkAchievement(
        fakeAchievement({
          code: seed.code,
          requirementType: seed.requirementType,
          requirement: seed.requirement,
        }),
        stats,
        []
      );
      // With everything maxed out, a badge that still cannot fire is one whose
      // requirement type falls through to `default`.
      expect({ code: seed.code, unlocked: result.isUnlocked }).toEqual({
        code: seed.code,
        unlocked: true,
      });
    }
  });

  it("keeps every achievement code unique across all seed parts", () => {
    const codes = achievements.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("files every POI badge under the poi domain", () => {
    expect([...seedsPartG, ...seedsPartH].every((s) => s.domain === "poi")).toBe(true);
  });

  /**
   * A southern latitude requirement must not be satisfied by a northern place.
   *
   * The measure is an ABSOLUTE degree so one number reads the same in both
   * hemispheres — which is exactly why the sign has to be checked before the
   * absolute value is taken. Without that, a place in Tromsø at 69°N would
   * quietly unlock "Ende der Welt".
   */
  it("does not award a southern badge for a northern place", async () => {
    const stats: UserStats = {
      ...(await baseStats()),
      placeNorthernLat: 69.6,
      placeSouthernLat: 41.9, // nothing south of the equator at all
    };

    const result = checkAchievement(
      fakeAchievement({ requirementType: "place_southern_lat", requirement: 35 }),
      stats,
      []
    );
    expect(result).toEqual({ isUnlocked: false, progress: 0 });
  });

  it("awards a northern badge on the absolute degree", async () => {
    const stats: UserStats = { ...(await baseStats()), placeNorthernLat: 66.7 };
    const result = checkAchievement(
      fakeAchievement({ requirementType: "place_northern_lat", requirement: 66 }),
      stats,
      []
    );
    expect(result).toEqual({ isUnlocked: true, progress: 66 });
  });
});
