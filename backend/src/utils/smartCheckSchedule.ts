/**
 * Smart API Check Scheduling
 *
 * Calculates the optimal time for the next API check on a scheduled flight.
 * Uses a geometric midpoint approach: the first check happens at ~50% of the
 * remaining time before departure, with subsequent checks closing in as
 * departure nears. Minimum interval is 10 minutes.
 */

const MIN_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const CHECK_WINDOW_AFTER_ARRIVAL_MS = 2 * 60 * 60 * 1000; // 2 hours post-arrival

/**
 * Calculate nextApiCheckAt for a flight.
 *
 * - Scheduled flights with a future departure: midpoint between now and departure
 * - Flights currently in the air: 15 minutes from now
 * - Flights already landed (+ 2h buffer): null (no more checks)
 * - Historical / cancelled / no departure time / no flight number: null
 */
export function calculateNextApiCheckAt(
  departureTime: Date | string | null | undefined,
  arrivalTime: Date | string | null | undefined,
  status: string,
  flightNumber: string | null | undefined,
  now: Date = new Date()
): Date | null {
  // No flight number means we can't look anything up
  if (!flightNumber) return null;

  // Only scheduled flights get API checks
  if (status !== 'scheduled') return null;

  // No departure time — can't schedule
  if (!departureTime) return null;

  const dep = typeof departureTime === 'string' ? new Date(departureTime) : departureTime;
  const arr = arrivalTime
    ? (typeof arrivalTime === 'string' ? new Date(arrivalTime) : arrivalTime)
    : null;

  const nowMs = now.getTime();
  const depMs = dep.getTime();

  // Flight already departed
  if (depMs <= nowMs) {
    // If arrival is known and we're past arrival + buffer, no more checks
    if (arr) {
      const bufferEnd = arr.getTime() + CHECK_WINDOW_AFTER_ARRIVAL_MS;
      if (nowMs > bufferEnd) return null;
    }
    // In-flight: check again in 15 minutes
    return new Date(nowMs + 15 * 60 * 1000);
  }

  // Future departure: midpoint between now and departure, but at least MIN_CHECK_INTERVAL
  const halfwayMs = Math.round((depMs - nowMs) / 2);
  const intervalMs = Math.max(halfwayMs, MIN_CHECK_INTERVAL_MS);

  return new Date(nowMs + intervalMs);
}

/**
 * Recalculate nextApiCheckAt after an API check has been performed.
 * Uses the same logic — the midpoint shrinks geometrically as departure nears.
 */
export function recalculateNextApiCheckAt(
  departureTime: Date | string | null | undefined,
  arrivalTime: Date | string | null | undefined,
  status: string,
  flightNumber: string | null | undefined
): Date | null {
  return calculateNextApiCheckAt(departureTime, arrivalTime, status, flightNumber);
}
