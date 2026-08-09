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
 * MIRRORED in `frontend/src/shared/ratingDerivation.ts` (the convention of
 * `shared/domains.ts` and `shared/statusDerivation.ts`) because the editor
 * shows the reader the same number the server is about to store. Both sides
 * are covered by tests asserting the same truth table; change one without the
 * other and those disagree, which is the point of having them.
 */

export interface StayRatingComponents {
  room: number | null;
  breakfast: number | null;
  service: number | null;
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
  const given = [input.room, input.breakfast, input.service].filter(
    (v): v is number => v !== null && v !== undefined,
  );
  if (given.length === 0) return input.current ?? null;
  const mean = given.reduce((sum, v) => sum + v, 0) / given.length;
  return Math.round(mean * 2) / 2;
}
