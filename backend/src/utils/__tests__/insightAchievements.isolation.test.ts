import { describe, it, expect, jest } from "@jest/globals";

import type { Achievement } from "../../prisma";
import logger from "../logger";
import { calculateInsightBadgeStats, EMPTY_INSIGHT_STATS } from "../insightAchievements";
import { planAchievementWrites } from "../achievementWrites";
import type { UserStats } from "../achievementStats";
import { cruise } from "../../services/stats/cruiseInsights/__tests__/fixtures";

/**
 * Review of forgejo#256/#257, fix round 1: a throwing insight measure must not
 * abort the badge check, and must not write its badges down to zero — they
 * keep their stored progress for that run.
 */

const achievement = (code: string, requirementType: string, requirement: number): Achievement =>
  ({
    id: `ach-${code}`,
    code,
    name: code,
    description: code,
    category: "special",
    domain: "cruise",
    icon: "x",
    tier: "silver",
    requirement,
    requirementType,
    points: 10,
    isHidden: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }) as Achievement;

describe("insight badge measures that fail", () => {
  it("log the failure and come back unmeasured, the other half still measured", async () => {
    const spy = jest.spyOn(logger, "error").mockImplementation(() => logger);
    const broken = cruise("x", "2024-01-01", "2024-01-02", null, null, []);
    const { insightStats: stats } = await calculateInsightBadgeStats("user-isolation", {
      flights: [],
      // A stop list that is not a list: the cruise half throws while mapping it.
      cruises: [{ id: broken.id, input: broken.input, stops: null as unknown as [] }],
    });
    expect(stats).toMatchObject({
      flightNewAirportsYearMax: 0,
      flightAirportReunionYears: 0,
      flightAirportQuartersMax: 0,
      cruisePortCruisesMax: null,
      cruiseExcursionPorts: null,
      cruiseRepeatedItineraryMax: null,
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "badge_source_failed",
        context: expect.objectContaining({ source: "cruiseInsights" }),
      })
    );
    spy.mockRestore();
  });

  it("leave their badges' stored rows alone instead of writing zero", () => {
    const portReunion = achievement("PORT_REUNION_3", "cruise_port_cruises", 3);
    const newGround = achievement("NEW_GROUND_YEAR", "flight_new_airports_year", 5);
    const existing = new Map([
      [
        portReunion.id,
        {
          id: "ua-1",
          userId: "u",
          achievementId: portReunion.id,
          progress: 2,
          unlockedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        newGround.id,
        {
          id: "ua-2",
          userId: "u",
          achievementId: newGround.id,
          progress: 4,
          unlockedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    ]);
    const plan = planAchievementWrites(
      [portReunion, newGround],
      existing as never,
      {} as UserStats,
      [],
      undefined,
      undefined,
      {
        ...EMPTY_INSIGHT_STATS,
        flightNewAirportsYearMax: 1,
        cruisePortCruisesMax: null,
        cruiseExcursionPorts: null,
        cruiseRepeatedItineraryMax: null,
      }
    );
    // A progress write names the stored row; the others the achievement.
    const touched = plan.writes.map((w) => ("rowId" in w ? w.rowId : w.achievementId));
    expect(touched).not.toContain("ua-1");
    // The measured half is written as usual: 4 → 1.
    expect(plan.writes).toEqual([{ kind: "progress", rowId: "ua-2", progress: 1 }]);
  });
});
