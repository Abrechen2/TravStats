import type { Flight } from "../types";
import {
  flightDurationOf,
  measureFlightMinutes as measureRow,
  type FlightDurationResult,
} from "../shared/flightDuration";

/** Re-exported shape so existing callers keep their import site. */
export type FlightDuration = FlightDurationResult;

/**
 * Single source of truth for "how long was this flight in the air?".
 *
 * Returns the real wall-clock duration when the row carries trustworthy
 * UTC times (`depTimeSemantics === 'UTC'`), otherwise falls back to a
 * great-circle estimate from the airport coordinates. Falls through to
 * `null` only when neither real times nor coordinates are available —
 * a state the schema should not allow.
 *
 * The rule itself lives in `shared/flightDuration.ts` so the server answers
 * identically (#268). This wrapper only knows how to read a `Flight`.
 *
 * Use this everywhere durations are displayed. Inline
 * `arrivalTime - departureTime` math will silently return 0 (or worse,
 * negative) for DATE_ONLY rows where the placeholder time component
 * has been collapsed to the same UTC instant on both ends.
 */
/**
 * The MEASURED minutes only — null when the row carries no trustworthy pair of
 * times. Split out so an aggregate can feed it to `addFlightDuration` and get
 * the measured/estimated breakdown, instead of a single number that hides which
 * it was (#268).
 */
export function measureFlightMinutes(flight: Flight): number | null {
  return measureRow(flight);
}

export function getFlightDuration(flight: Flight): FlightDuration | null {
  return flightDurationOf({
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    depTimeSemantics: flight.depTimeSemantics,
    depLat: flight.depLat ?? null,
    depLon: flight.depLon ?? null,
    arrLat: flight.arrLat ?? null,
    arrLon: flight.arrLon ?? null,
  });
}

/** Convenience for sort comparators / aggregates that need a single number. */
export function getFlightDurationMinutes(flight: Flight): number {
  return getFlightDuration(flight)?.minutes ?? 0;
}
