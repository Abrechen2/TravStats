/**
 * Smart API Check Scheduling
 *
 * Limits each flight to at most three API checks across its whole lifecycle:
 *
 *   1. Pre-departure (~30 min before departure): gate / terminal / aircraft
 *   2. Pre-arrival (~60 min before scheduled arrival): actual_departure, delays
 *   3. Post-arrival (~30 min after scheduled arrival): actual_arrival, flown status
 *
 * Flights without arrivalTime fall back to a synthetic +12h arrival so the
 * schedule still terminates. Flights that were created very close to (or after)
 * a checkpoint skip past it to the next one.
 *
 * Rationale: Previous logic polled every 15 min while in-flight, which burned
 * 30-50+ API calls per long-haul flight for essentially the same data. Three
 * well-placed checks capture everything the user cares about at ~90% less cost.
 */

import { FLIGHT_ARRIVAL_SLACK_HOURS } from '../shared/statusDerivation';

const PRE_DEPARTURE_LEAD_MS = 30 * 60 * 1000;
const PRE_ARRIVAL_LEAD_MS = 60 * 60 * 1000;
const POST_ARRIVAL_LAG_MS = 30 * 60 * 1000;
const FALLBACK_FLIGHT_DURATION_MS = 12 * 60 * 60 * 1000;

/**
 * Follow-up polling for a flight that departed but has not been seen arriving.
 *
 * The three checkpoints above are all derived from SCHEDULED times, so the last
 * one lands at scheduled arrival + 30 min. Any delay larger than that leaves the
 * aircraft still airborne when it fires, and returning null there ends polling
 * forever — the arrival can then never be recorded. (Observed on LO729
 * WAW→EVN, 2026-07-21: departed 41 min late, last poll ran ~11 min before
 * touchdown, actual_arrival stayed NULL.)
 *
 * The window deliberately reuses the status-sweep slack: once the sweep flips
 * the flight to "flown" it also clears nextApiCheckAt, so polling past that
 * point would be wasted API budget.
 */
const ARRIVAL_FOLLOWUP_INTERVAL_MS = 30 * 60 * 1000;
const ARRIVAL_FOLLOWUP_WINDOW_MS = FLIGHT_ARRIVAL_SLACK_HOURS * 60 * 60 * 1000;

/**
 * What the last API response (or the stored row) told us about the flight.
 * Defaults to "nothing observed", which preserves the plain 3-checkpoint
 * behaviour for callers that create flights and have no tracking data yet.
 */
export interface ObservedTracking {
  hasActualDeparture?: boolean;
  hasActualArrival?: boolean;
}

/**
 * Calculate nextApiCheckAt for a flight.
 *
 * Returns the earliest future checkpoint, or null if all checkpoints are in the
 * past or the flight is not eligible (historical / cancelled / no flight number
 * / no departure time).
 */
export function calculateNextApiCheckAt(
  departureTime: Date | string | null | undefined,
  arrivalTime: Date | string | null | undefined,
  status: string,
  flightNumber: string | null | undefined,
  now: Date = new Date(),
  tracking: ObservedTracking = {}
): Date | null {
  if (!flightNumber) return null;
  if (status !== 'scheduled') return null;
  if (!departureTime) return null;

  const dep = typeof departureTime === 'string' ? new Date(departureTime) : departureTime;
  const arr = arrivalTime
    ? (typeof arrivalTime === 'string' ? new Date(arrivalTime) : arrivalTime)
    : new Date(dep.getTime() + FALLBACK_FLIGHT_DURATION_MS);

  const nowMs = now.getTime();
  const depMs = dep.getTime();
  const arrMs = arr.getTime();

  const checkpoints = [
    depMs - PRE_DEPARTURE_LEAD_MS,
    arrMs - PRE_ARRIVAL_LEAD_MS,
    arrMs + POST_ARRIVAL_LAG_MS,
  ];

  // Deduplicate and sort — prevents degenerate overlaps on very short flights
  // (e.g. MUC→VIE 55 min) where the pre-arrival checkpoint could land before
  // the pre-departure one.
  const sorted = Array.from(new Set(checkpoints)).sort((a, b) => a - b);

  for (const checkpointMs of sorted) {
    if (checkpointMs > nowMs) return new Date(checkpointMs);
  }

  // All fixed checkpoints are in the past. If the aircraft was seen departing
  // but never seen arriving it is presumably still airborne (or landed after
  // the last checkpoint), so keep polling until the status sweep takes over.
  if (tracking.hasActualDeparture && !tracking.hasActualArrival) {
    const followUpDeadlineMs = arrMs + ARRIVAL_FOLLOWUP_WINDOW_MS;
    if (nowMs < followUpDeadlineMs) {
      return new Date(Math.min(nowMs + ARRIVAL_FOLLOWUP_INTERVAL_MS, followUpDeadlineMs));
    }
  }

  // Nothing left to check.
  return null;
}

/**
 * Recalculate nextApiCheckAt after an API check has been performed.
 * Returns the next future checkpoint (moving on from the one we just hit).
 */
export function recalculateNextApiCheckAt(
  departureTime: Date | string | null | undefined,
  arrivalTime: Date | string | null | undefined,
  status: string,
  flightNumber: string | null | undefined,
  tracking: ObservedTracking = {}
): Date | null {
  return calculateNextApiCheckAt(
    departureTime,
    arrivalTime,
    status,
    flightNumber,
    new Date(),
    tracking
  );
}
