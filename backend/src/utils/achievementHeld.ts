// The one home for "does the user hold this badge".
//
// The answer is the live measure: `progress >= requirement`. Owner's ruling,
// 2026-09-20 — "Löschen löscht auch Punkte, der Live-Stand wird gezählt".
// Delete the flights behind a badge and the badge goes, and the points with
// it: the list, the category counts, the total, the rank and the leaderboard
// all read the data as it is now. A trophy case that keeps showing a badge for
// flights that are no longer in the logbook is describing a logbook the user
// does not have.
//
// For one day this read `progress >= requirement OR unlockedAt IS NOT NULL`.
// That came out of the 2026-09-19 integrity audit, which found two ways a
// measure falls without the user doing anything:
//
//   - `AWAY_SHARE_25`, earned 2026-09-03, came back at progress 24 on the 2.6.2
//     prod mirror, because `lodgingStats/rhythm.ts` divides the CURRENT year by
//     the days elapsed so far, so the share drifts down every night spent at
//     home.
//   - `NOT_A_MORNING_PERSON` moved between users when CT106 booted with
//     TZ=Europe/Berlin, purely because the process clock had moved.
//
// Both were real defects and both are fixed at the source (the departure clock
// is the airport's own — `achievementStats.departureClock.test.ts`). Making the
// date confer the badge was a second, broader answer to them, and the owner
// ruled it out: it silently froze every badge, including the ones a user had
// genuinely stopped holding.
//
// What stays from that day is the part that was never about held-ness:
// `unlockedAt` is a historical fact — the first time the requirement was met —
// and is NEVER cleared or overwritten. Nothing in this module reads it, and
// nothing anywhere writes NULL to it. It is what lets a card that has dropped
// back to a progress bar still say when the badge was last held, instead of a
// number falling with no explanation.

/**
 * The parts of a `UserAchievement` row that decide held-ness.
 *
 * `progress` alone, deliberately. While the date was part of the rule this
 * interface also demanded `unlockedAt`, so that a Prisma `select` which forgot
 * the column would fail to compile rather than hand the function an
 * `undefined` it read as a date — measured in `routes/achievements.rank.test.ts`,
 * where a LOCKED 9000-point badge was counted and moved the user two rungs up
 * the rank ladder. The rule no longer reads that column, so the hazard is gone
 * by construction rather than by a type that has to be remembered.
 */
export interface HeldInput {
  progress: number;
}

/**
 * True when the user holds the badge: the measure meets the requirement NOW.
 *
 * No `unlockedAt` term. A row carrying a date but measuring below its
 * requirement is not held — it is a badge the user had and does not have any
 * more, and its date is a label for the UI, not a claim on the points.
 */
export function isAchievementHeld(row: HeldInput | null | undefined, requirement: number): boolean {
  if (!row) return false;
  return row.progress >= requirement;
}
