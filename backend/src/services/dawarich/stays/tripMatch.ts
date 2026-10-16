import { tripSpan, type TripSpanColumns } from "../../places/visitTrip";

/**
 * The trip a stay (or a market visit) falls in, by its first and last local day.
 *
 * Trip days are read by the shared rule (`tripSpan` → `readDay`): the time
 * model's day column, else the legacy anchor read by the backfill's own rule.
 * Reading `startDate.toISOString()` instead put a trip a UTC+2 browser saved at
 * local midnight one day early, so a stay on its first or last day matched no
 * trip — or the neighbouring one.
 *
 * `overlapping` are the trips touching the interval; the trip is named only when
 * exactly one touches it AND that one holds it whole.
 */
export function tripForStay<T extends TripSpanColumns>(
  trips: readonly T[],
  firstDay: string,
  lastDay: string
): { trip: T | null; overlapping: T[]; containing: T[] } {
  const spans = trips.flatMap((t) => {
    const span = tripSpan(t);
    return span ? [{ trip: t, span }] : [];
  });
  const overlapping = spans.filter((s) => s.span.first <= lastDay && s.span.last >= firstDay);
  const containing = overlapping.filter((s) => s.span.first <= firstDay && s.span.last >= lastDay);
  return {
    trip: overlapping.length === 1 && containing.length === 1 ? containing[0].trip : null,
    overlapping: overlapping.map((s) => s.trip),
    containing: containing.map((s) => s.trip),
  };
}

/** A trip as the market preview carries it: instants as ISO strings. */
export interface SerializedTripSpan {
  id: string;
  startDate: string | null;
  endDate: string | null;
  startDay?: string | null;
  endDay?: string | null;
  startZone?: string | null;
  endZone?: string | null;
}

const asDate = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

export function tripSpanColumns(t: SerializedTripSpan): TripSpanColumns {
  return {
    id: t.id,
    startDate: asDate(t.startDate),
    endDate: asDate(t.endDate),
    startDay: asDate(t.startDay),
    endDay: asDate(t.endDay),
    startZone: t.startZone ?? null,
    endZone: t.endZone ?? null,
  };
}
