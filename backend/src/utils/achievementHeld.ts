// The one home for "does the user hold this badge".
//
// It used to be `progress >= requirement`, inlined at five places, and the
// column comment said so: "held-ness is derived from the numbers, never from
// `unlockedAt` — the date is a label on that fact, not the fact itself". That
// reading makes every badge a rented one, because a measure is allowed to fall
// for reasons that have nothing to do with the user:
//
//   - The 2026-09-19 integrity audit booted the 2.6.2 prod mirror and watched
//     `AWAY_SHARE_25` — earned 2026-09-03 — come back with progress 25 → 24 and
//     `unlockedAt` NULL, because `lodgingStats/rhythm.ts` divides the CURRENT
//     year by the days elapsed so far, so the share drifts down every night the
//     traveller spends at home.
//   - The same audit booted CT106 with TZ=Europe/Berlin and saw
//     `NOT_A_MORNING_PERSON` taken from two users and handed to a third, dated
//     that day, purely because the process clock had moved.
//
// Neither is the user un-earning anything. The owner's rule (the "achievement
// engine monotonic" note) is that a badge once earned stays earned, so the
// question has to be answerable from something a re-measurement cannot undo.
// `unlockedAt` is that something: it is written the moment a badge is earned
// and never cleared again.
//
// `progress` remains a live measurement and may fall — it is what the progress
// bar shows, and a number that could only ever rise would be a lie about the
// data. Holding is the union: the measure is met NOW, or it was met ONCE.

/** The parts of a `UserAchievement` row that decide held-ness. */
export interface HeldInput {
  progress: number;
  unlockedAt: Date | null;
}

/**
 * True when the user holds the badge: the measure meets the requirement now,
 * or a previous run recorded that it once did.
 *
 * EITHER, not BOTH. A date without the measure is the case this rule exists
 * for. A measure without a date is the ordinary steady state of a badge earned
 * before `unlockedAt` meant anything: migration `20260902170000` nulled every
 * row whose progress sat below its requirement and left the rest alone, so a
 * surviving date is a real unlock and a missing one on a row that meets its
 * requirement is only a gap in the record. `planAchievementWrites` fills that
 * gap the next time it sees the row.
 *
 * What this cannot do is give back a badge the old revoke path already emptied:
 * such a row lost its date AND sits below its requirement, and nothing in the
 * table remembers it. Those come back when the measure does.
 */
export function isAchievementHeld(row: HeldInput | null | undefined, requirement: number): boolean {
  if (!row) return false;
  return row.progress >= requirement || row.unlockedAt !== null;
}
