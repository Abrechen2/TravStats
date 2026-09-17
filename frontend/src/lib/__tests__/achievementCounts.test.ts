import { describe, it, expect } from "vitest";
import type { Achievement } from "../../types";
import { countAchievements } from "../achievementCounts";

const achievement = (over: Partial<Achievement>): Achievement => ({
  id: "a",
  code: "FIRST_FLIGHT",
  name: "",
  description: "",
  category: "milestone",
  icon: "",
  tier: "bronze",
  requirement: 1,
  requirementType: "",
  points: 10,
  isHidden: false,
  createdAt: "2026-01-01T00:00:00Z",
  domain: "flight",
  ...over,
});

// CT106 design-6 R08: the page said "58 of 276", the stats overview 57.
describe("countAchievements", () => {
  it("leaves an earned retired achievement out of the fraction and names it", () => {
    const counts = countAchievements([
      achievement({ id: "1", isUnlocked: true }),
      achievement({ id: "2", isUnlocked: false }),
      achievement({ id: "3", code: "FOUR_SEASONS_YEAR", isUnlocked: true, isRetired: true }),
    ]);
    expect(counts).toEqual({ unlocked: 1, total: 2, retiredUnlocked: 1 });
  });

  it("counts every achievement when none is retired", () => {
    const counts = countAchievements([
      achievement({ id: "1", isUnlocked: true }),
      achievement({ id: "2" }),
    ]);
    expect(counts).toEqual({ unlocked: 1, total: 2, retiredUnlocked: 0 });
  });
});
