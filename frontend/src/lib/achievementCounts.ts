import type { Achievement } from "../types";

export interface AchievementCounts {
  /** Unlocked achievements the catalogue still offers. */
  unlocked: number;
  /** Achievements the catalogue still offers. */
  total: number;
  /** Unlocked achievements whose definition was removed. */
  retiredUnlocked: number;
}

/**
 * The page header's fraction, counted by the rule the API's summary uses: a
 * retired achievement a user already earned stays on the page and keeps its
 * points, but it is outside "x of y" — otherwise the page read "58 of 276"
 * while the stats overview, reading the summary, said 57 (CT106 design-6 R08).
 *
 * "Earned" here means HELD RIGHT NOW. Owner's ruling, 2026-09-20 — the live
 * data is what counts, so a badge whose measure has fallen below its
 * requirement leaves the numerator. That is why the count reads `isUnlocked`
 * and never the presence of `unlockedAt`: since the same ruling the API sends
 * that date on a badge it reports as NOT held, so the card can say when it was
 * last held. A count that read the date would put every lapsed badge back.
 */
export function countAchievements(achievements: readonly Achievement[]): AchievementCounts {
  let unlocked = 0;
  let total = 0;
  let retiredUnlocked = 0;
  for (const achievement of achievements) {
    if (achievement.isRetired) {
      if (achievement.isUnlocked) retiredUnlocked += 1;
      continue;
    }
    total += 1;
    if (achievement.isUnlocked) unlocked += 1;
  }
  return { unlocked, total, retiredUnlocked };
}
