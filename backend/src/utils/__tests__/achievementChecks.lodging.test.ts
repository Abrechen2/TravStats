// Lodging + cross-domain requirement-type dispatch for `checkAchievement`.
//
// Two invariants matter more than any single case:
//   1. Every `requirementType` referenced by `seedsPartD` MUST have a real
//      `case` in the switch — a missing case silently falls through to the
//      `default` branch (progress 0, never unlocked) and the achievement
//      can never fire for a real user.
//   2. Every achievement `code` across all seed parts MUST be unique — a
//      duplicate collides on `achievement.code`'s unique constraint during
//      seeding.
import type { Achievement } from "@prisma/client";
import { checkAchievement } from "../achievementChecks";
import { calculateUserStats, type UserStats } from "../achievementStats";
import { achievements } from "../../data/achievements";
import { seedsPartA } from "../../data/achievementSeeds/partA";
import { seedsPartB } from "../../data/achievementSeeds/partB";
import { seedsPartC } from "../../data/achievementSeeds/partC";
import { seedsPartE } from "../../data/achievementSeeds/partE";
import { seedsPartD } from "../../data/achievementSeeds/partD";

jest.mock("../../services/airportCache", () => ({
  getCachedAirports: jest.fn(async () => new Map()),
}));

function fakeAchievement(overrides: Partial<Achievement>): Achievement {
  return {
    id: "test-id",
    code: "TEST_CODE",
    name: "Test",
    description: "Test",
    category: "special",
    domain: "lodging",
    icon: "🏨",
    tier: "bronze",
    requirement: 1,
    requirementType: "lodgings_count",
    points: 10,
    isHidden: false,
    createdAt: new Date(),
    ...overrides,
  } as Achievement;
}

describe("checkAchievement — lodging requirement types", () => {
  it("evaluates lodging_nights against UserStats.lodgingNights", async () => {
    const base = await calculateUserStats([]);
    const stats: UserStats = { ...base, lodgingNights: 12 };

    expect(
      checkAchievement(
        fakeAchievement({ requirementType: "lodging_nights", requirement: 10 }),
        stats,
        [],
      ).isUnlocked,
    ).toBe(true);
    expect(
      checkAchievement(
        fakeAchievement({ requirementType: "lodging_nights", requirement: 50 }),
        stats,
        [],
      ).isUnlocked,
    ).toBe(false);
  });

  it("evaluates fly_and_stay / grand_tour as booleans", async () => {
    const base = await calculateUserStats([]);
    const stats: UserStats = { ...base, flyAndStay: true, grandTour: false };

    expect(
      checkAchievement(
        fakeAchievement({ requirementType: "fly_and_stay", requirement: 1 }),
        stats,
        [],
      ).isUnlocked,
    ).toBe(true);
    expect(
      checkAchievement(
        fakeAchievement({ requirementType: "grand_tour", requirement: 1 }),
        stats,
        [],
      ).isUnlocked,
    ).toBe(false);
  });

  it("every requirementType used by seedsPartD/E is handled by a real case (no silent default fallthrough)", async () => {
    const base = await calculateUserStats([]);
    // "Maxed out" stats: every lodging/shared numeric field set far above
    // any requirement in the catalog, every boolean true, and the one
    // Set-typed field (`lodgingCountries`) padded past any requirement.
    // If `checkAchievement` dispatches to the correct case, isUnlocked
    // must be true for every definition. If the switch is missing a case
    // for a `requirementType`, it falls through to `default` (progress 0)
    // and isUnlocked is false — that's the failure this test catches.
    const maxedCountries = new Set(Array.from({ length: 500 }, (_, i) => `country-${i}`));
    const maxedStats: UserStats = {
      ...base,
      lodgingsCount: 1_000_000,
      lodgingNights: 1_000_000,
      lodgingChainsUnique: 1_000_000,
      lodgingCountries: maxedCountries,
      lodgingSpendBase: 1_000_000,
      lodgingAwardNights: 1_000_000,
      lodgingChainLoyaltyMax: 1_000_000,
      lodgingSameHotelRepeatMax: 1_000_000,
      lodgingLongestStayNights: 1_000_000,
      lodgingStaysCount: 1_000_000,
      // Measures added with the 2.7 statistics expansion. Latitude is the one
      // that is NOT a plain count — 90 is the pole, so nothing above it can be
      // required and 1_000_000 would make the test pass for a broken case.
      lodgingTypesUnique: 1_000_000,
      lodgingCitiesUnique: 1_000_000,
      lodgingContinents: 1_000_000,
      lodgingFiveStarNights: 1_000_000,
      lodgingAllInclusiveNights: 1_000_000,
      lodgingPerfectStays: 1_000_000,
      lodgingEnduredStays: 1_000_000,
      lodgingRatedStays: 1_000_000,
      lodgingOneNightStays: 1_000_000,
      lodgingStreakNights: 1_000_000,
      lodgingAwaySharePct: 100,
      lodgingIndependentNights: 1_000_000,
      lodgingProgrammeYearNights: 1_000_000,
      lodgingNorthernmostLat: 90,
      tripsFullyDocumented: 1_000_000,
      flyAndStay: true,
      grandTour: true,
    };

    const untestedTypes: string[] = [];
    for (const def of [...seedsPartD, ...seedsPartE]) {
      const { isUnlocked, progress } = checkAchievement(
        fakeAchievement({
          requirementType: def.requirementType,
          requirement: def.requirement,
        }),
        maxedStats,
        [],
      );
      if (!isUnlocked || progress <= 0) {
        untestedTypes.push(`${def.code} (${def.requirementType})`);
      }
    }

    expect(untestedTypes).toEqual([]);
  });
});

describe("achievement seed integrity", () => {
  it("has no duplicate codes across partA + partB + partC + partD + partE", () => {
    const allCodes = [...seedsPartA, ...seedsPartB, ...seedsPartC, ...seedsPartD, ...seedsPartE].map(
      (a) => a.code,
    );
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const code of allCodes) {
      if (seen.has(code)) duplicates.push(code);
      seen.add(code);
    }
    expect(duplicates).toEqual([]);
  });

  it("the aggregated `achievements` export includes every partD and partE entry", () => {
    const achievementCodes = new Set(achievements.map((a) => a.code));
    for (const def of [...seedsPartD, ...seedsPartE]) {
      expect(achievementCodes.has(def.code)).toBe(true);
    }
  });
});
