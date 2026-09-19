/**
 * The year in review, exactly as `GET /stats/wrapped` derives it.
 *
 * MIRRORS `backend/src/schemas/statsWrapped.ts`; change both together.
 *
 * Two fields exist so a client does not have to decide anything on the user's
 * behalf. `availableYears` is the picker's whole content, so the page can
 * never offer a year whose story is empty; `comparisonYear` names the one year
 * that beat this one ONLY when exactly one did, which is why `rank` has a
 * `second` at all. Everything else is `other`, and the copy stays vague on
 * purpose rather than inventing a ranking out of a tie.
 */

export type WrappedRank = "top" | "second" | "other";

export interface WrappedAirline {
  name: string;
  /**
   * The two-letter prefix of the flight number when it is written the usual
   * way, and null rather than a guess otherwise — the name is the identity,
   * the code only decorates the tile.
   */
  code: string | null;
  flights: number;
}

export interface WrappedRoute {
  from: string;
  to: string;
  flights: number;
}

export interface Wrapped {
  year: number;
  /** Every year with countable activity, ascending. The year picker's content. */
  availableYears: number[];
  rank: WrappedRank;
  /** The one year that beat this one, when exactly one did. */
  comparisonYear: number | null;
  flights: number;
  distanceKm: number;
  /** `distanceKm` in trips around the Earth, one decimal. */
  earthFactor: number;
  /**
   * Countries first evidenced in this year AND reaching the user's counting
   * threshold — taken from the passport rather than re-decided, so the story
   * cannot count from a different tier than the passport it sits beside.
   */
  newCountries: number;
  cruises: number;
  /** Null when no flight of the year named a carrier. */
  topAirline: WrappedAirline | null;
  /** The year's most-flown PAIR, codes sorted — not a direction. */
  topRoute: WrappedRoute | null;
}
