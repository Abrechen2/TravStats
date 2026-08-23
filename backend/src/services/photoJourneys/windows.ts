import type { TravelWindow } from "./cluster";

/**
 * Everything the user has already told us about, as stretches of time.
 *
 * A photo cluster overlapping any of these is explained, and mentioning
 * it would be telling someone about a holiday they are looking at in the
 * app already. The four domains are folded into one shape here so the
 * clustering never has to know what a cruise is.
 *
 * Pure on purpose: the shapes below are the fields as Prisma returns
 * them, so a caller can pass rows straight in, but nothing here touches
 * a database.
 */

/** A flight, reduced to the times that bound it. */
export interface FlightWindowInput {
  departureTime: Date | null;
  arrivalTime: Date | null;
  status: string;
}

/** A trip or a cruise: both are simply a date range. */
export interface RangeWindowInput {
  startDate: Date | null;
  endDate: Date | null;
}

/** A hotel stay. */
export interface StayWindowInput {
  checkIn: Date | null;
  checkOut: Date | null;
}

/**
 * A cancelled flight explains nothing.
 *
 * It is the one status that means the travel did NOT happen, so photos
 * on that date are evidence of something else — very often the trip the
 * user took instead, which is exactly what this feature is for.
 */
const CANCELLED = "cancelled";

function toWindow(
  start: Date | null,
  end: Date | null,
): TravelWindow | null {
  const startMs = start?.getTime();
  const endMs = end?.getTime();
  // A row with only one side still bounds a day: a flight with no arrival
  // time is not a reason to ignore the departure we do know about.
  const known = [startMs, endMs].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (known.length === 0) {
    return null;
  }
  return {
    startMs: Math.min(...known),
    endMs: Math.max(...known),
  };
}

/**
 * Fold every recorded domain into one list of explained stretches.
 *
 * Overlaps are left in rather than merged. The coverage check asks
 * "does any window overlap this cluster", which a redundant window
 * cannot change — and merging first would cost a sort on every scan to
 * buy nothing.
 */
export function travelWindows({
  flights = [],
  trips = [],
  cruises = [],
  stays = [],
}: {
  flights?: readonly FlightWindowInput[];
  trips?: readonly RangeWindowInput[];
  cruises?: readonly RangeWindowInput[];
  stays?: readonly StayWindowInput[];
}): TravelWindow[] {
  const windows: TravelWindow[] = [];

  for (const flight of flights) {
    if (flight.status === CANCELLED) {
      continue;
    }
    const window = toWindow(flight.departureTime, flight.arrivalTime);
    if (window !== null) {
      windows.push(window);
    }
  }

  for (const range of [...trips, ...cruises]) {
    const window = toWindow(range.startDate, range.endDate);
    if (window !== null) {
      windows.push(window);
    }
  }

  for (const stay of stays) {
    const window = toWindow(stay.checkIn, stay.checkOut);
    if (window !== null) {
      windows.push(window);
    }
  }

  return windows;
}
