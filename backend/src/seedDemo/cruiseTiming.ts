/**
 * When a seeded cruise calls at a port.
 *
 * Both cruise seeders derived the clock times from the START of the cruise:
 * embarkation instant plus n days, plus a fixed number of hours. That reads
 * fine for day one and drifts for every day after it — the narrated
 * Mittelmeer cruise embarks at 16:00 and ends at 08:00 on the last day, so its
 * final stop was recorded as arriving eight hours AFTER the cruise was over
 * (finding B5 of the independent review of 2026-09-17).
 *
 * The times a port call actually has are a property of ITS OWN DAY, not of the
 * hour the ship left on day one. So: the stop's calendar day, at the hours a
 * ship is alongside, clamped into the cruise's own window — a stop can never
 * be outside the journey it belongs to, whatever hours the itinerary carries.
 */

/** Alongside in the morning, away in the late afternoon — a normal port day. */
const ARRIVAL_HOUR_UTC = 8;
const DEPARTURE_HOUR_UTC = 17;

function clamp(instant: Date, start: Date, end: Date): Date {
  if (instant.getTime() < start.getTime()) return new Date(start.getTime());
  if (instant.getTime() > end.getTime()) return new Date(end.getTime());
  return new Date(instant.getTime());
}

/**
 * `dayIndex` is 0-based: 0 is the embarkation day, so `dayNumber` is
 * `dayIndex + 1`, which is the numbering the stop invariant requires.
 */
export function stopTimesForDay(
  start: Date,
  end: Date,
  dayIndex: number,
): { arrivalTime: Date; departureTime: Date } {
  const dayStart = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate() + dayIndex,
  );
  const arrivalTime = clamp(new Date(dayStart + ARRIVAL_HOUR_UTC * 3_600_000), start, end);
  const departureTime = clamp(new Date(dayStart + DEPARTURE_HOUR_UTC * 3_600_000), start, end);
  // A day clamped from both sides can end up with the departure at the earlier
  // instant (an itinerary whose last stop is on the disembarkation morning).
  // The stop then has no span rather than a negative one.
  return departureTime.getTime() < arrivalTime.getTime()
    ? { arrivalTime: departureTime, departureTime }
    : { arrivalTime, departureTime };
}
