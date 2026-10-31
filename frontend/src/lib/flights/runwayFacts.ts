import type { TimeValue } from "../../shared/time";
import type { FlightTimes } from "../../types/times";

/**
 * What the runway clock adds to a flight: the take-off and touch-down
 * instants, and the spans between them and the gate times.
 *
 * Abstention is a result: every span is measured only between two instants
 * known to the minute, on `TimeValue.utc`, and a negative or empty span is
 * discarded rather than shown. A missing end gives null, never 0.
 */
export interface RunwayFacts {
  takeoff: TimeValue | null;
  touchdown: TimeValue | null;
  /** Gate departure to take-off, in minutes. */
  taxiOutMinutes: number | null;
  /** Take-off to touch-down, in minutes. */
  airMinutes: number | null;
  /** Touch-down to gate arrival, in minutes. */
  taxiInMinutes: number | null;
}

function span(from: TimeValue | null | undefined, to: TimeValue | null | undefined): number | null {
  if (!from || !to || from.precision !== "minute" || to.precision !== "minute") return null;
  const minutes = Math.round((Date.parse(to.utc) - Date.parse(from.utc)) / 60000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

export function runwayFacts(times: FlightTimes | undefined): RunwayFacts {
  const takeoff = times?.runwayDeparture ?? null;
  const touchdown = times?.runwayArrival ?? null;
  return {
    takeoff,
    touchdown,
    taxiOutMinutes: span(times?.actualDeparture, takeoff),
    airMinutes: span(takeoff, touchdown),
    taxiInMinutes: span(touchdown, times?.actualArrival),
  };
}
