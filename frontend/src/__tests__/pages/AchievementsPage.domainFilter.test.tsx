import { describe, it, expect } from "vitest";

import { filterAchievementsByDomain } from "../../pages/AchievementsPage";
import type { Achievement } from "../../types";

/**
 * Builder for a minimal Achievement fixture — the full Achievement interface
 * has many required fields that are irrelevant to the domain-filter logic, so
 * we compose a default and only override the bits each case cares about.
 */
const makeAchievement = (
  overrides: Partial<Achievement> & Pick<Achievement, "id" | "domain">
): Achievement => ({
  code: `CODE_${overrides.id}`,
  name: `Achievement ${overrides.id}`,
  description: "d",
  category: "explorer",
  icon: "",
  tier: "bronze",
  requirement: 1,
  requirementType: "flights_count",
  points: 10,
  isHidden: false,
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("filterAchievementsByDomain", () => {
  const flight = makeAchievement({ id: "1", name: "First flight", domain: "flight" });
  const cruise = makeAchievement({ id: "2", name: "First cruise", domain: "cruise" });
  const shared = makeAchievement({ id: "3", name: "10 countries", domain: "shared" });

  it("shows flight and shared when only flight is enabled, hides cruise", () => {
    const result = filterAchievementsByDomain([flight, cruise, shared], ["flight"]);

    expect(result.map((a) => a.name)).toEqual(["First flight", "10 countries"]);
    expect(result.map((a) => a.name)).not.toContain("First cruise");
  });

  it("shows all matching domains plus shared when multiple are enabled", () => {
    const result = filterAchievementsByDomain([flight, cruise, shared], ["flight", "cruise"]);

    expect(result).toHaveLength(3);
  });

  it("shows only shared achievements when no domain is enabled", () => {
    const result = filterAchievementsByDomain([flight, cruise, shared], []);

    expect(result.map((a) => a.name)).toEqual(["10 countries"]);
  });

  it("hides achievements with unknown domains (forward compat — not in enabled list)", () => {
    const unknown = makeAchievement({ id: "4", name: "Mystery", domain: "future_domain" });
    const result = filterAchievementsByDomain([flight, unknown, shared], ["flight"]);

    expect(result.map((a) => a.name)).toEqual(["First flight", "10 countries"]);
  });

  it("treats `shared` as always visible regardless of enabled list", () => {
    const result = filterAchievementsByDomain([shared], []);

    expect(result).toEqual([shared]);
  });
});
