// The trip map's day model: which calendar days a trip spans, and which of its
// entries fall on a chosen day.
//
// Every span is read through `lib/entityTimes` and the entry's OWN clock
// (`local`, `date`), never the viewer's — a flight that lands at 01:00 in
// Tokyo belongs to the Tokyo day, whatever the browser's zone says. An entry
// with no readable date has no span: it is dimmed while a day is chosen,
// because it cannot be shown to belong to that day.

import {
  cruiseEnd,
  cruiseStart,
  flightArrival,
  flightDeparture,
  railArrival,
  railDeparture,
  stayCheckIn,
  stayCheckOut,
  tripStopEnd,
  tripStopStart,
  visitTime,
} from "../../lib/entityTimes";
import { addDays, daysBetween } from "../../shared/time/calendar";
import { timeValueAtZone } from "../../shared/time";
import type { Trip } from "../../types";

/** An inclusive run of calendar days, `YYYY-MM-DD` on the entry's own clock. */
export interface DaySpan {
  start: string;
  end: string;
}

/** A span longer than this is not expanded into chips (a year-long stay). */
const MAX_SPAN_DAYS = 120;
const DAY = /^\d{4}-\d{2}-\d{2}/;

const dayOf = (local: string | null | undefined): string | null =>
  local && DAY.test(local) ? local.slice(0, 10) : null;

export function spanOf(a: string | null | undefined, b?: string | null): DaySpan | null {
  const start = dayOf(a) ?? dayOf(b);
  if (!start) return null;
  const end = dayOf(b) ?? start;
  return end < start ? { start: end, end: start } : { start, end };
}

/** The span covering both, for an entity visited more than once. */
export function widenSpan(a: DaySpan | null, b: DaySpan | null): DaySpan | null {
  if (!a || !b) return a ?? b;
  return { start: a.start < b.start ? a.start : b.start, end: a.end > b.end ? a.end : b.end };
}

export function spanHasDay(span: DaySpan | null, day: string | null): boolean {
  if (day === null) return true;
  return span !== null && span.start <= day && day <= span.end;
}

type Timed = { local: string } | null | undefined;
const local = (v: Timed): string | null => v?.local ?? null;

export const flightSpan = (f: Parameters<typeof flightDeparture>[0]): DaySpan | null =>
  spanOf(local(flightDeparture(f)), local(flightArrival(f)));

export const cruiseSpan = (c: Parameters<typeof cruiseStart>[0]): DaySpan | null =>
  spanOf(cruiseStart(c)?.date, cruiseEnd(c)?.date);

export const staySpan = (s: Parameters<typeof stayCheckIn>[0]): DaySpan | null =>
  spanOf(stayCheckIn(s)?.date, stayCheckOut(s)?.date);

export interface StopLike {
  startDate?: string | null;
  endDate?: string | null;
  times?: Parameters<typeof tripStopStart>[0]["times"];
}

export function stopSpan(s: StopLike): DaySpan | null {
  const stop = { startDate: s.startDate ?? null, endDate: s.endDate ?? null, times: s.times };
  return spanOf(local(tripStopStart(stop)), local(tripStopEnd(stop)));
}

export const railSpan = (j: Parameters<typeof railDeparture>[0]): DaySpan | null =>
  spanOf(local(railDeparture(j)), local(railArrival(j)));

/** A ferry or bus ride: two instants, each at its own terminal's zone. */
export function rideSpan(r: {
  departureTime: string;
  arrivalTime: string | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  times?: { departure?: Timed; arrival?: Timed };
}): DaySpan | null {
  const dep = r.times?.departure ?? timeValueAtZone(r.departureTime, r.depTimezone);
  const arr = r.times?.arrival ?? timeValueAtZone(r.arrivalTime, r.arrTimezone);
  return spanOf(local(dep), local(arr));
}

export function rentalSpan(r: {
  pickupTime: string;
  returnTime: string;
  pickupTimezone: string;
  returnTimezone: string;
}): DaySpan | null {
  return spanOf(
    local(timeValueAtZone(r.pickupTime, r.pickupTimezone)),
    local(timeValueAtZone(r.returnTime, r.returnTimezone))
  );
}

export const visitSpan = (v: Parameters<typeof visitTime>[0]): DaySpan | null =>
  spanOf(local(visitTime(v)));

/** Split a list by whether each entry is on `day` (everything is, with no day). */
export function splitByDay<T>(
  items: readonly T[],
  spanFor: (item: T) => DaySpan | null,
  day: string | null
): { active: T[]; rest: T[] } {
  const active: T[] = [];
  const rest: T[] = [];
  for (const item of items) (spanHasDay(spanFor(item), day) ? active : rest).push(item);
  return { active, rest };
}

/** Every distinct day the spans touch, ascending. A span is cut at `MAX_SPAN_DAYS`. */
export function collectDays(spans: readonly (DaySpan | null)[]): string[] {
  const days = new Set<string>();
  for (const span of spans) {
    if (!span) continue;
    const length = Math.min(daysBetween(span.start, span.end), MAX_SPAN_DAYS);
    for (let i = 0; i <= length; i += 1) days.add(addDays(span.start, i));
  }
  return [...days].sort();
}

/** What a trip's day list reads: the same entries the map draws. */
export interface TripDaySource {
  flights?: Trip["flights"];
  cruises?: Trip["cruises"];
  lodgingStays?: Trip["lodgingStays"];
  stops?: ReadonlyArray<StopLike>;
  railJourneys?: Trip["railJourneys"];
  ferryJourneys?: Trip["ferryJourneys"];
  busJourneys?: Trip["busJourneys"];
  rentalBookings?: Trip["rentalBookings"];
}

export function tripDays(
  trip: TripDaySource,
  placeVisits: ReadonlyArray<Parameters<typeof visitTime>[0]> = []
): string[] {
  return collectDays([
    ...(trip.flights ?? []).map(flightSpan),
    ...(trip.cruises ?? []).map(cruiseSpan),
    ...(trip.lodgingStays ?? []).map(staySpan),
    ...(trip.stops ?? []).map(stopSpan),
    ...(trip.railJourneys ?? []).map(railSpan),
    ...(trip.ferryJourneys ?? []).map(rideSpan),
    ...(trip.busJourneys ?? []).map(rideSpan),
    ...(trip.rentalBookings ?? []).map(rentalSpan),
    ...placeVisits.map(visitSpan),
  ]);
}
