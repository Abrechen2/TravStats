/**
 * Single source of truth for "how long was this flight in the air?" (#268).
 *
 * The same figure used to be answered three ways on one screen: the overview
 * card estimated a duration from the great-circle distance for rows that carry
 * only a date, while `/stats/summary` and `/stats/timeseries` contributed 0 for
 * exactly those rows. All three were visible at once and disagreed, and nothing
 * told the reader that part of the first number was an estimate — the frontend
 * helper returned an `estimated` flag and its caller dropped it.
 *
 * The rule lives here so both sides answer identically:
 *
 *   1. A measured duration wins whenever there is one. Measuring is each
 *      caller's job — the server does it timezone-aware
 *      (`tzAwareDurationMinutes`), which is why this function takes the result
 *      rather than the timestamps.
 *   2. Otherwise estimate from the airport coordinates, and SAY SO. An estimate
 *      that cannot be told apart from a measurement is worse than no estimate.
 *   3. With neither times nor coordinates there is no answer. `null`, not 0 —
 *      a zero would silently drag every average down, which is the bug this
 *      file exists to end.
 *
 * MIRRORED in `frontend/src/shared/flightDuration.ts` (the convention of
 * `shared/ratingDerivation.ts` and `shared/statusDerivation.ts`). Both copies
 * are covered by tests asserting the same numbers; change one without the other
 * and the aggregate and the row disagree again.
 */

/** Earth mean radius in kilometres (IUGG) — same constant as `geo/haversine.ts`. */
const EARTH_RADIUS_KM = 6371.0088;
const RAD_PER_DEG = Math.PI / 180;

/**
 * Cruise speed used for the estimate. A round 800 km/h is the long-standing
 * value from `timeEstimation.ts`; it is a heuristic, not a claim about any
 * particular airframe.
 */
export const ESTIMATE_CRUISE_SPEED_KMH = 800;

/** Taxi, climb and descent, added on top of the cruise leg. */
export const ESTIMATE_GROUND_OVERHEAD_MINUTES = 15;

export interface FlightDurationResult {
  minutes: number;
  /** True when the value came from coordinates rather than from clocks. */
  estimated: boolean;
}

export interface FlightDurationInput {
  /**
   * Wall-clock minutes between departure and arrival, or null when the row
   * carries no trustworthy pair of times. Callers that cannot measure
   * timezone-aware should pass null rather than a naive difference — a
   * DATE_ONLY row whose placeholder times collapse to the same instant
   * measures as 0, and 0 is indistinguishable from a real answer.
   */
  measuredMinutes: number | null;
  depLat: number | null;
  depLon: number | null;
  arrLat: number | null;
  arrLon: number | null;
}

/** Great-circle distance in kilometres. Self-contained on purpose: this file
 * is mirrored into the frontend, where the geo helpers are a different module. */
export function greatCircleKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * RAD_PER_DEG;
  const dLon = (lon2 - lon1) * RAD_PER_DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD_PER_DEG) * Math.cos(lat2 * RAD_PER_DEG) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Heuristic duration from coordinates. Returns null when a coordinate is
 * missing, and null for a zero-length hop — an airport to itself is not a
 * 15-minute flight, it is a row we cannot answer for.
 */
export function estimateDurationMinutes(
  depLat: number | null,
  depLon: number | null,
  arrLat: number | null,
  arrLon: number | null,
): number | null {
  if (
    typeof depLat !== "number" ||
    typeof depLon !== "number" ||
    typeof arrLat !== "number" ||
    typeof arrLon !== "number"
  ) {
    return null;
  }
  const km = greatCircleKm(depLat, depLon, arrLat, arrLon);
  if (km <= 0) return null;
  return Math.round((km / ESTIMATE_CRUISE_SPEED_KMH) * 60) + ESTIMATE_GROUND_OVERHEAD_MINUTES;
}

/** Applies the three rules in the file header. */
export function resolveFlightDuration(input: FlightDurationInput): FlightDurationResult | null {
  if (input.measuredMinutes !== null && input.measuredMinutes > 0) {
    return { minutes: input.measuredMinutes, estimated: false };
  }
  const est = estimateDurationMinutes(input.depLat, input.depLon, input.arrLat, input.arrLon);
  if (est === null) return null;
  return { minutes: est, estimated: true };
}

/** What an aggregate must report so a total can say how much of it is guessed. */
export interface FlightDurationTotals {
  /** Measured + estimated, in minutes. The headline figure. */
  totalMinutes: number;
  /** The part that came from clocks. */
  measuredMinutes: number;
  /** The part that came from coordinates. */
  estimatedMinutes: number;
  /** Flights that contributed a measured duration. */
  measuredCount: number;
  /** Flights that contributed an estimate. */
  estimatedCount: number;
  /**
   * Flights that contributed nothing — neither times nor coordinates. Kept so
   * an average can divide by what actually contributed. Dividing by ALL flights
   * is what made the overview's average systematically too low.
   */
  unknownCount: number;
}

export function emptyDurationTotals(): FlightDurationTotals {
  return {
    totalMinutes: 0,
    measuredMinutes: 0,
    estimatedMinutes: 0,
    measuredCount: 0,
    estimatedCount: 0,
    unknownCount: 0,
  };
}

/** Folds one flight into a running total. Pure — returns a new object. */
export function addFlightDuration(
  totals: FlightDurationTotals,
  input: FlightDurationInput,
): FlightDurationTotals {
  const d = resolveFlightDuration(input);
  if (d === null) return { ...totals, unknownCount: totals.unknownCount + 1 };
  if (d.estimated) {
    return {
      ...totals,
      totalMinutes: totals.totalMinutes + d.minutes,
      estimatedMinutes: totals.estimatedMinutes + d.minutes,
      estimatedCount: totals.estimatedCount + 1,
    };
  }
  return {
    ...totals,
    totalMinutes: totals.totalMinutes + d.minutes,
    measuredMinutes: totals.measuredMinutes + d.minutes,
    measuredCount: totals.measuredCount + 1,
  };
}

/**
 * The average a screen should show: divided by the flights that CONTRIBUTED,
 * not by every flight. Returns null when nothing contributed, so the caller
 * renders an em dash rather than a confident zero.
 */
export function averageDurationMinutes(totals: FlightDurationTotals): number | null {
  const contributing = totals.measuredCount + totals.estimatedCount;
  if (contributing === 0) return null;
  return totals.totalMinutes / contributing;
}
