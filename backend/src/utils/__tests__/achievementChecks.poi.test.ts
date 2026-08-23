// POI requirement-type dispatch for `checkAchievement`.
//
// The invariant that matters most here is the one the lodging suite states for
// its own part: every `requirementType` in `seedsPartG` MUST resolve to real
// logic. A missing case falls through to `default` (progress 0, never
// unlocked), and the badge is then simply unreachable — silently, forever.
//
// POI adds a second one. Its checklist badges do NOT use a plain case: the list
// key rides inside the requirement type (`curated_list_complete:<key>`). So the
// test has to prove both that the prefix is honoured AND that two checklists
// report SEPARATE progress — a single shared maximum would make every wonders
// badge show the same number, which is exactly what the per-list map exists to
// prevent.
import type { Achievement } from "@prisma/client";
import { checkAchievement } from "../achievementChecks";
import { calculateUserStats, type UserStats } from "../achievementStats";
import { seedsPartG } from "../../data/achievementSeeds/partG";
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

  describe("curated_list_complete:<key>", () => {
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
          requirementType: "curated_list_complete:world-wonders-new7",
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
          requirementType: "curated_list_complete:world-wonders-ancient",
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
          requirementType: "curated_list_complete:not-shipped-yet",
          requirement: 7,
        }),
        await stats(),
        []
      );
      expect(result).toEqual({ isUnlocked: false, progress: 0 });
    });
  });

  it("gives every seedsPartG requirement type real logic", async () => {
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
      curatedTickedByList: new Map([
        ["world-wonders-new7", 7],
        ["world-wonders-ancient", 7],
      ]),
    };

    for (const seed of seedsPartG) {
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
    expect(seedsPartG.every((s) => s.domain === "poi")).toBe(true);
  });
});
