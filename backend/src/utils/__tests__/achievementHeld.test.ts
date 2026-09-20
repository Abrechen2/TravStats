/**
 * Held-ness: `progress >= requirement`, and nothing else.
 *
 * For one day — 2026-09-19 — it was `progress >= requirement OR unlockedAt IS
 * NOT NULL`, so a badge whose measure had fallen went on being counted. The
 * owner's ruling of 2026-09-20 replaced that: "Löschen löscht auch Punkte, der
 * Live-Stand wird gezählt". Delete the flights and the points go with them.
 *
 * What survived the reversal is the other half of that day's fix, and it is
 * pinned elsewhere (`achievements.revocation.test.ts`,
 * `achievementWrites.test.ts`): `unlockedAt` is a historical fact and is never
 * cleared. It simply no longer decides anything here — which is why the cases
 * below hand this function a date and expect it to be ignored.
 */

import { isAchievementHeld, type HeldInput } from "../achievementHeld";

/**
 * A row as a forgetful `select` or a stub produces it.
 *
 * It used to be the whole point of this file: while the date was part of the
 * rule, a row arriving without the column read as `undefined`, and
 * `unlockedAt !== null` handed out the badge — measured in
 * `routes/achievements.rank.test.ts`, where a LOCKED 9000-point achievement
 * was counted into the user's rank. The rule no longer reads that column, so
 * the hazard is gone by construction; the case stays because a row with only a
 * progress value is still the shape a hand-written `select` produces.
 */
const withoutTheColumn = { progress: 0 } as unknown as HeldInput;

describe("isAchievementHeld", () => {
  it("does not hand out a badge to a row that carries only a progress value", () => {
    expect(isAchievementHeld(withoutTheColumn, 10)).toBe(false);
  });

  it("holds a badge whose measure meets the requirement", () => {
    expect(isAchievementHeld({ progress: 12, unlockedAt: null }, 10)).toBe(true);
  });

  it("does NOT hold a badge whose measure has fallen, however old the date on it", () => {
    // The owner's ruling of 2026-09-20. The user deleted the flights behind
    // this badge; the points go with them, and the card goes back to showing a
    // progress bar. The date stays in the database — see
    // `achievements.revocation.test.ts` — it just no longer confers anything.
    expect(isAchievementHeld({ progress: 4, unlockedAt: new Date("2026-09-03") }, 10)).toBe(false);
  });

  it("holds a badge that meets its requirement but was never dated", () => {
    // Migration `20260902170000` left such rows behind, and so does any run
    // from before the column meant anything. The numbers decide.
    expect(isAchievementHeld({ progress: 10, unlockedAt: null }, 10)).toBe(true);
  });

  it("does not hold a badge that was neither earned nor measured", () => {
    expect(isAchievementHeld({ progress: 4, unlockedAt: null }, 10)).toBe(false);
  });

  it("holds nothing for a user with no row at all", () => {
    expect(isAchievementHeld(null, 10)).toBe(false);
    expect(isAchievementHeld(undefined, 10)).toBe(false);
  });
});
