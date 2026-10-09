/**
 * Review I4 (forgejo#258–#264): a statistics source that fails during a badge
 * check must not cost a badge. Its measures arrive as null, the checker says
 * "skip", and the planner leaves the stored row exactly as it is — a failed
 * read is not a fallen measure.
 */
import { planAchievementWrites } from "../achievementWrites";
import { EMPTY_INSIGHT_STATS } from "../insightAchievements";
import { EMPTY_RAIL_STATS } from "../railAchievements";
import type { Achievement, UserAchievement } from "../../prisma";
import type { UserStats } from "../achievementStats";

const badge = (code: string, requirementType: string, requirement: number): Achievement => ({
  id: `ach-${code}`,
  code,
  name: code,
  description: code,
  category: "explorer",
  domain: "roadtrip",
  icon: "x",
  tier: "bronze",
  requirement,
  requirementType,
  points: 10,
  isHidden: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const ROADTRIP_KM = badge("ROADTRIP_KM_1000", "roadtrip_km", 1000);
const TOUR_FIRST = badge("TOUR_FIRST_STEPS", "tour_count", 1);

const held = (achievement: Achievement): UserAchievement =>
  ({
    id: `row-${achievement.code}`,
    userId: "u",
    achievementId: achievement.id,
    progress: achievement.requirement,
    unlockedAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
  }) as UserAchievement;

describe("planAchievementWrites — a failed source is skipped, never zeroed", () => {
  it("writes nothing for roadtrip badges whose measures could not be read", () => {
    const plan = planAchievementWrites(
      [ROADTRIP_KM],
      new Map([[ROADTRIP_KM.id, held(ROADTRIP_KM)]]),
      {} as UserStats,
      [],
      null,
      EMPTY_RAIL_STATS,
      EMPTY_INSIGHT_STATS
    );
    expect(plan.writes).toEqual([]);
    expect(plan.belowRequirement).toEqual([]);
  });

  it("writes nothing for a Part K badge whose source failed, and still decides the others", () => {
    const plan = planAchievementWrites(
      [TOUR_FIRST, ROADTRIP_KM],
      new Map([[TOUR_FIRST.id, held(TOUR_FIRST)]]),
      {} as UserStats,
      [],
      { ...emptyRoadtrip(), roadtripKm: 1200 },
      EMPTY_RAIL_STATS,
      { ...EMPTY_INSIGHT_STATS, tourCount: null }
    );
    expect(plan.writes).toEqual([
      expect.objectContaining({ kind: "unlock", achievementId: ROADTRIP_KM.id }),
    ]);
  });
});

function emptyRoadtrip() {
  return {
    roadtripsCount: 0,
    roadtripKm: 0,
    roadtripFreeNights: 0,
    roadtripLongestKm: 0,
    roadtripCountriesMax: 0,
    roadtripBaseCamps: 0,
    roadtripLandAndWater: 0,
    roadtripTourStations: 0,
  };
}
