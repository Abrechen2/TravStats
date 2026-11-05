/**
 * Single source of truth for the OVERALL stay rating (Alex, Discord
 * 2026-07-12: the overall used to be a fourth identical picker, so a stay
 * could carry 5/5/5 with an overall of 2 and nothing in the product would
 * notice). The stored `rating_overall` column is a CACHE of this function —
 * every write path calls it: both stay routes and the import commit.
 *
 * It lives here rather than in the editor component because a deriver that
 * runs only where it is DISPLAYED is correct only for values typed there. The
 * first version derived inside `StayEditorRatingsSection`, so CSV and
 * e-mail/PDF imports wrote null and every hotel and chain average read "—" —
 * the feature looked finished and was defeated on two of three write paths.
 * Same lesson, same fix as `statusDerivation.ts`.
 *
 * MIRRORED in `backend/src/shared/ratingDerivation.ts` (the convention of
 * `shared/domains.ts` and `shared/statusDerivation.ts`) because the editor
 * shows the reader the same number the server is about to store. Both sides
 * are covered by tests asserting the same truth table; change one without the
 * other and those disagree, which is the point of having them.
 *
 * The load-bearing rule of the switchable categories: the overall is the mean
 * of the values the STAY HAS — it never sees which categories the user has
 * switched on. Averaging the active set would make switching "Frühstück" off
 * rewrite the overall of every old stay the next time it is saved.
 */

export interface StayRatingComponents {
  room?: number | null;
  breakfast?: number | null;
  service?: number | null;
  /**
   * Every other category (built-in or own), keyed as on the stay's `ratings`
   * map. A key here wins over the same key above.
   */
  ratings?: Record<string, number | null | undefined>;
  /**
   * An overall score the SOURCE supplied on its own — an import column, a
   * legacy row. Consulted only when no component rating exists (see below).
   */
  current?: number | null;
}

/**
 * Half-star mean of whichever component ratings are present.
 *
 * The components always win when there is at least one: an overall that
 * contradicts them is exactly the state this derivation exists to prevent,
 * and it makes no difference whether the contradiction was typed or imported.
 *
 * With NO component at all, an explicitly supplied overall survives. A source
 * that scores the stay as a whole (a Booking.com score, a row written before
 * the components existed) is the user's own data with nothing to contradict
 * it — dropping it would be a silent loss, and returning null would make the
 * editor wipe it the first time the stay is opened and saved.
 */
export function deriveStayOverallRating(input: StayRatingComponents): number | null {
  const merged: Record<string, number | null | undefined> = {
    room: input.room,
    breakfast: input.breakfast,
    service: input.service,
    ...input.ratings,
  };
  const given = Object.values(merged).filter((v): v is number => v !== null && v !== undefined);
  if (given.length === 0) return input.current ?? null;
  const mean = given.reduce((sum, v) => sum + v, 0) / given.length;
  return Math.round(mean * 2) / 2;
}

/** Fewest rated categories that can make a stay "perfect" — one lone 5 must not earn a gold badge. */
export const PERFECT_STAY_MIN_CATEGORIES = 3;

/**
 * "Nichts zu beanstanden": at least three categories rated and every rated one
 * a 5. Replaces "all four columns at 5", which stopped meaning anything once
 * the set of categories varies. Only ever grants more than the old rule did
 * (a 5/5/5/5 stay satisfies it), so no unlocked achievement is revoked.
 */
export function isPerfectStay(ratings: Record<string, number | null | undefined>): boolean {
  const given = Object.values(ratings).filter((v): v is number => v !== null && v !== undefined);
  return given.length >= PERFECT_STAY_MIN_CATEGORIES && given.every((v) => v === 5);
}

/** The columns a row may still carry from before the `ratings` map existed. */
export interface StoredRatingSource {
  ratings?: unknown;
  ratingRoom?: number | null;
  ratingBreakfast?: number | null;
  ratingService?: number | null;
}

/**
 * A stay's category values as one clean map. The JSON map wins; the three
 * legacy columns fill in only the keys it lacks, so a row written by a path
 * that still knows only the columns (trip import, old client) loses nothing.
 * Non-numeric junk in the JSON is dropped rather than trusted.
 */
export function storedRatingsOf(row: StoredRatingSource): Record<string, number> {
  const out: Record<string, number> = {};
  const legacy: Record<string, number | null | undefined> = {
    room: row.ratingRoom,
    breakfast: row.ratingBreakfast,
    service: row.ratingService,
  };
  for (const [key, value] of Object.entries(legacy)) {
    if (typeof value === "number") out[key] = value;
  }
  if (row.ratings && typeof row.ratings === "object" && !Array.isArray(row.ratings)) {
    for (const [key, value] of Object.entries(row.ratings as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    }
  }
  return out;
}
