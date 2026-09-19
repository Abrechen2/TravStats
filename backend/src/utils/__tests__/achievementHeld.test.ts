/**
 * Held-ness: `progress >= requirement OR unlockedAt IS NOT NULL`.
 *
 * The case worth its own file is the one that is neither: a row that does not
 * carry the column at all. A Prisma `select` may leave it out, and a test stub
 * usually does. `unlockedAt !== null` reads that `undefined` as a date and
 * hands out the badge — measured the day the rule shipped, where
 * `routes/achievements.rank.test.ts` stubbed its rows without it and a LOCKED
 * 9000-point achievement was counted into the user's rank.
 */

import { isAchievementHeld, type HeldInput } from "../achievementHeld";

/**
 * A row as a forgetful `select` or a stub produces it. The cast is the point:
 * `HeldInput` requires `unlockedAt`, so this shape cannot occur through the
 * type — only at runtime, which is where it did occur.
 */
const withoutTheColumn = { progress: 0 } as unknown as HeldInput;

describe("isAchievementHeld", () => {
  it("does not hand out a badge to a row that never carried the column", () => {
    expect(isAchievementHeld(withoutTheColumn, 10)).toBe(false);
  });

  it("holds a badge whose measure still meets the requirement", () => {
    expect(isAchievementHeld({ progress: 12, unlockedAt: null }, 10)).toBe(true);
  });

  it("holds a badge whose measure has fallen but which was earned once", () => {
    // The whole reason the union exists — see the module header.
    expect(isAchievementHeld({ progress: 4, unlockedAt: new Date() }, 10)).toBe(true);
  });

  it("does not hold a badge that was neither earned nor measured", () => {
    expect(isAchievementHeld({ progress: 4, unlockedAt: null }, 10)).toBe(false);
  });

  it("holds nothing for a user with no row at all", () => {
    expect(isAchievementHeld(null, 10)).toBe(false);
    expect(isAchievementHeld(undefined, 10)).toBe(false);
  });
});
