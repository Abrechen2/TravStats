import { createHash } from "crypto";
import { achievements, type AchievementDefinition } from "../../data/achievements";

/** The badges that may travel to a friend's server (rule: `data/achievementComparable.ts`). */
export function comparableAchievements(): readonly AchievementDefinition[] {
  return achievements.filter((a) => a.comparable === true);
}

/**
 * Definition version of the comparable set: two servers whose hashes differ define at least one
 * shared badge differently, so a reader compares only codes both sides know.
 */
export function catalogueVersion(): string {
  const lines = comparableAchievements()
    .map((a) => `${a.code}:${a.requirement}:${a.tier}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
}
