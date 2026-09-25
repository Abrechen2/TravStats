import type { Trip } from "../types";
import { localWallClockOf } from "../shared/localWallClock";
import { dayOf } from "./tripForDate";

/** The fields the span reads — a caller need not build a whole Trip. */
export type TripWithEntries = Pick<Trip, "flights" | "cruises" | "lodgingStays">;

export interface DaySpan {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  /** YYYY-MM-DD, inclusive. */
  end: string;
}

const CANCELLED = "cancelled";

/**
 * The calendar days a trip's own entries cover: the first day any flight,
 * cruise or stay starts to the last day any of them ends — the same entries,
 * and the same one-ended fallback, that `tripStatusBounds` derives the trip's
 * status from on the server.
 *
 * In days, not instants, because the trip form edits calendar dates. A flight's
 * day is the one on the clock at ITS airport: a 23:30 departure from New York
 * is that evening, not the next UTC day. A cancelled entry did not happen and
 * does not widen the trip.
 *
 * Null when no entry carries a date — abstention, not an empty trip.
 */
export function tripEntrySpan(trip: TripWithEntries): DaySpan | null {
  const ranges: Array<[string | null, string | null]> = [];

  for (const f of trip.flights ?? []) {
    if (f.status === CANCELLED || !f.departureTime) continue;
    const start = localWallClockOf(
      new Date(f.departureTime),
      f.depTimezone,
      f.depTimeSemantics
    ).date;
    const end = f.arrivalTime
      ? localWallClockOf(new Date(f.arrivalTime), f.arrTimezone, f.arrTimeSemantics).date
      : start;
    ranges.push([start, end]);
  }
  for (const c of trip.cruises ?? []) {
    if (c.status === CANCELLED) continue;
    ranges.push([dayOf(c.startDate), dayOf(c.endDate)]);
  }
  for (const s of trip.lodgingStays ?? []) {
    if (s.status === CANCELLED) continue;
    ranges.push([dayOf(s.checkIn), dayOf(s.checkOut)]);
  }

  const starts = ranges.map(([start, end]) => start ?? end).filter((d): d is string => !!d);
  const ends = ranges.map(([start, end]) => end ?? start).filter((d): d is string => !!d);
  if (starts.length === 0 || ends.length === 0) return null;
  return {
    start: starts.reduce((a, b) => (b < a ? b : a)),
    end: ends.reduce((a, b) => (b > a ? b : a)),
  };
}
