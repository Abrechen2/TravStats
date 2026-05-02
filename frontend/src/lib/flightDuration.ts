import type { Flight } from "../types";
import { estimateDurationHeuristic } from "./timeEstimation";

export interface FlightDuration {
  minutes: number;
  estimated: boolean;
}

/**
 * Single source of truth for "how long was this flight in the air?".
 *
 * Returns the real wall-clock duration when the row carries trustworthy
 * UTC times (`depTimeSemantics === 'UTC'`), otherwise falls back to a
 * great-circle estimate from the airport coordinates. Falls through to
 * `null` only when neither real times nor coordinates are available —
 * a state the schema should not allow.
 *
 * Use this everywhere durations are displayed or aggregated. Inline
 * `arrivalTime - departureTime` math will silently return 0 (or worse,
 * negative) for DATE_ONLY rows where the placeholder time component
 * has been collapsed to the same UTC instant on both ends.
 */
export function getFlightDuration(flight: Flight): FlightDuration | null {
  const semOk = (flight.depTimeSemantics ?? "UTC") === "UTC";
  if (semOk && flight.departureTime && flight.arrivalTime) {
    const real = (new Date(flight.arrivalTime).getTime() - new Date(flight.departureTime).getTime()) / 60000;
    if (real > 0) return { minutes: real, estimated: false };
  }

  if (
    typeof flight.depLat === "number" &&
    typeof flight.depLon === "number" &&
    typeof flight.arrLat === "number" &&
    typeof flight.arrLon === "number"
  ) {
    const est = estimateDurationHeuristic(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon);
    if (est > 0) return { minutes: est, estimated: true };
  }

  return null;
}

/** Convenience for sort comparators / aggregates that need a single number. */
export function getFlightDurationMinutes(flight: Flight): number {
  return getFlightDuration(flight)?.minutes ?? 0;
}
