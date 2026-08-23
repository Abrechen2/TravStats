/**
 * Single source of truth for "does this place count?".
 *
 * The sibling of `shared/lodgingCounting.ts`, and it answers the same owner
 * rule in the shape this domain has: a figure comes from DATA AND DATES, never
 * from a status string.
 *
 * Two independent questions, deliberately not conflated:
 *
 *   - `Place.visited`   — is this in my logbook, or only on my wishlist?
 *   - `PlaceVisit`      — when was I there?
 *
 * A place can be `visited` with ZERO visit rows ("I have definitely been to
 * that Maccis, no idea when") and it still counts — the LodgingStay 2.7
 * precedent, where a stay that cannot be dated is still a stay. A place can
 * equally be `visited === false` with zero visits: a wishlist entry, or an
 * unticked checklist target. That one counts nowhere.
 *
 * The future-date rule is the part that is easy to get wrong and invisible
 * when you do: a visit dated next month is NOT a visit. It shows on the trip
 * where it belongs, and it is excluded from every figure and from the
 * "visited" map layer — exactly as a stay whose check-out has not passed is.
 *
 * MIRRORED in `frontend/src/shared/placeCounting.ts`. Change both together.
 */

/** Which bucket a place or a visit falls into. */
export type PlaceCountState = "visited" | "planned" | "excluded";

export interface CountablePlace {
  visited: boolean;
  /**
   * Visits still in the future, as the server derives them. Optional so a
   * caller that only has the stored row can still ask the visited question.
   */
  plannedVisitCount?: number;
}

export interface CountableVisit {
  visitedAt: Date | string | null;
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A visit with no date counts as `visited`, not `planned`.
 *
 * That looks generous until you consider what an undated visit actually is:
 * something the user is recording after the fact. Nobody enters a plan without
 * a date. Treating the gap as "planned" would quietly drop real history out of
 * every total, which is the failure mode this rule exists to prevent.
 */
export function classifyVisit(visit: CountableVisit, now: Date = new Date()): PlaceCountState {
  const at = toDate(visit.visitedAt);
  if (at === null) return "visited";
  return at.getTime() > now.getTime() ? "planned" : "visited";
}

/**
 * Whether a place belongs in "Orte besucht".
 *
 * Reads `Place.visited` alone and does NOT require a visit row, because the
 * two questions are independent (see the file header). A place the user marked
 * as visited but never dated is a visit that happened; a wishlist entry with a
 * dated future visit attached is still not one.
 */
export function classifyPlace(place: CountablePlace): PlaceCountState {
  if (place.visited) return "visited";
  // A place nobody has been to yet, but that a dated future visit points at,
  // is PLANNED rather than a bare wishlist entry — the same distinction a
  // flight before departure and a stay before check-in already carry. It is
  // derived, never stored: the date says it, exactly as this file's header
  // demands. `plannedVisitCount` comes from the server, which excludes those
  // visits from every total already.
  if ((place.plannedVisitCount ?? 0) > 0) return "planned";
  return "excluded";
}

/** Count of places that actually happened. */
export function countVisitedPlaces(places: readonly CountablePlace[]): number {
  return places.reduce((n, p) => (classifyPlace(p) === "visited" ? n + 1 : n), 0);
}

/**
 * Count of visits that actually happened — future-dated ones excluded.
 * Distinct from `countVisitedPlaces`: three visits to one McDonald's is one
 * place and three visits, and conflating the two is what the whole
 * Place/PlaceVisit split exists to prevent (#177).
 */
export function countCompletedVisits(
  visits: readonly CountableVisit[],
  now: Date = new Date()
): number {
  return visits.reduce((n, v) => (classifyVisit(v, now) === "visited" ? n + 1 : n), 0);
}

/**
 * Distinct ISO country codes among places that count. Joins on the derived
 * `isoCountryCode`, never the free-text `country` — "Deutschland" and
 * "Germany" are one country, and only the code knows that.
 */
export function countPlaceCountries(
  places: readonly (CountablePlace & { isoCountryCode: string | null })[]
): number {
  const seen = new Set<string>();
  for (const p of places) {
    if (classifyPlace(p) !== "visited") continue;
    if (p.isoCountryCode) seen.add(p.isoCountryCode.toUpperCase());
  }
  return seen.size;
}
