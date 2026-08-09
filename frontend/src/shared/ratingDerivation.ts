/**
 * Frontend MIRROR of `backend/src/shared/ratingDerivation.ts`, following the
 * same convention as `shared/domains.ts` and `shared/statusDerivation.ts`.
 *
 * The stay editor shows the reader the overall score their component ratings
 * produce, so the client has to compute the same answer the server will store.
 *
 * The rules MUST stay identical to the backend. Both sides are covered by
 * tests asserting the same truth table; change one without the other and those
 * disagree, which is the point of having them.
 */

export interface StayRatingComponents {
  room: number | null;
  breakfast: number | null;
  service: number | null;
  /** An overall the SOURCE supplied itself — an import column, a legacy row. */
  current?: number | null;
}

/**
 * Half-star mean of whichever component ratings are present.
 *
 * The components always win when there is at least one — an overall that
 * contradicts them is the state this derivation exists to prevent. With no
 * component at all, an explicitly supplied overall survives rather than being
 * silently wiped the first time the stay is opened and saved.
 */
export function deriveStayOverallRating(input: StayRatingComponents): number | null {
  const given = [input.room, input.breakfast, input.service].filter(
    (v): v is number => v !== null && v !== undefined
  );
  if (given.length === 0) return input.current ?? null;
  const mean = given.reduce((sum, v) => sum + v, 0) / given.length;
  return Math.round(mean * 2) / 2;
}
