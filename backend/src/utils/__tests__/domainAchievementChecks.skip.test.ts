import { describe, it, expect, jest } from "@jest/globals";

/**
 * A badge module whose loader THROWS answers "skip" for its own rules: the
 * stored rows stay exactly as they are — a held badge is not revoked by a
 * progress of 0, and nothing is written — while every other badge is checked
 * as usual (the sibling insight loaders' verdict, forgejo#262/#263/#265).
 */
jest.mock("../rentalAchievements", () => {
  const actual =
    jest.requireActual<typeof import("../rentalAchievements")>("../rentalAchievements");
  return {
    ...actual,
    calculateRentalAchievementStats: async () => {
      throw new Error("rental table unreachable");
    },
  };
});
jest.mock("../busAchievements", () => {
  const actual = jest.requireActual<typeof import("../busAchievements")>("../busAchievements");
  return {
    ...actual,
    calculateBusAchievementStats: async () => ({
      busRidesCount: 2,
      busNightRides: 0,
      busTerminals: 3,
    }),
  };
});
jest.mock("../crossDomainAchievements", () => {
  const actual = jest.requireActual<typeof import("../crossDomainAchievements")>(
    "../crossDomainAchievements"
  );
  return {
    ...actual,
    calculateCrossDomainAchievementStats: async () => actual.EMPTY_CROSS_DOMAIN_STATS,
  };
});
jest.mock("../logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn() },
}));

import { loadDomainAchievementChecks } from "../domainAchievementChecks";
import { planAchievementWrites } from "../achievementWrites";
import type { Achievement, UserAchievement } from "../../prisma";
import type { UserStats } from "../achievementStats";

const badge = (id: string, requirementType: string, requirement: number): Achievement =>
  ({
    id,
    code: id,
    name: id,
    description: "",
    category: "explorer",
    domain: requirementType.startsWith("rental") ? "rental" : "bus",
    icon: "",
    tier: "bronze",
    requirement,
    requirementType,
    points: 10,
    isHidden: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }) as Achievement;

describe("a badge loader that throws", () => {
  it("answers skip for its own rules and leaves every other module working", async () => {
    const { checks } = await loadDomainAchievementChecks("user-1");
    const answer = (requirementType: string) =>
      checks.map((c) => c({ requirementType, requirement: 1 })).find((r) => r !== null);
    expect(answer("rental_count")).toBe("skip");
    expect(answer("bus_count")).toEqual({ isUnlocked: true, progress: 2 });
  });

  it("writes nothing for a held rental badge — no revocation, no write", async () => {
    const { checks } = await loadDomainAchievementChecks("user-1");
    const rental = badge("RENTAL_FIRST", "rental_count", 1);
    const bus = badge("BUS_TERMINALS_10", "bus_terminals", 10);
    const held = {
      id: "row-r",
      userId: "user-1",
      achievementId: rental.id,
      progress: 1,
      unlockedAt: new Date("2026-05-01T00:00:00Z"),
    } as UserAchievement;
    const plan = planAchievementWrites(
      [rental, bus],
      new Map([[rental.id, held]]),
      {} as unknown as UserStats,
      [],
      undefined,
      undefined,
      undefined,
      checks
    );
    expect(plan.belowRequirement).toEqual([]);
    expect(plan.writes).toEqual([{ kind: "track", achievementId: bus.id, progress: 3 }]);
  });
});
