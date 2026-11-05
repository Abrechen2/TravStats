/**
 * Days away, per domain — the one measure the design charter lets every
 * domain share (forgejo#92).
 *
 * The charter rules that no figure is SUMMED across domains: a flight, a
 * cruise night and a hotel night are not the same unit and adding them
 * produces a number nobody can read. The one thing they have in common is a
 * calendar day on which the traveller was demonstrably away, and that is what
 * this module counts — per domain, and once across all of them.
 *
 * ## The definition, stated once
 *
 * For each domain, the number of DISTINCT calendar days on which the account
 * holds a record that HAPPENED in that domain:
 *
 * - a flight counts its departure day and its arrival day;
 * - a cruise counts every day from departure to arrival, inclusive;
 * - a lodging stay counts every day from check-in to check-out, inclusive;
 * - a place visit counts its visit day;
 * - a roadtrip station counts the days it attests (`attestStation`): its
 *   whole span for a night, its one day for a station driven through;
 * - a train ride counts its departure day and its arrival day, each on its
 *   STATION'S calendar (`railDayKeys`) — the loader reduces it, as it does a
 *   roadtrip station, because a night train's two days only exist on the
 *   stations' clocks;
 * - a coach ride or a ferry crossing counts its departure and arrival day on
 *   its TERMINALS' calendars (`busDayKeys`, `ferryDayKeys`), reduced by the
 *   loader the same way.
 *
 * `total` is the size of the UNION of the eight day sets — never their sum. A
 * day with a flight in the morning and a hotel at night is one day away, and
 * reporting it as two is precisely the cross-domain addition the charter
 * forbids.
 *
 * ## Which clock
 *
 * A day is the UTC date of the STORED instant. Stays and visits are stored as
 * hotel-local and place-local wall clocks pinned to UTC midnight, so for them
 * the UTC date IS the local date. A flight's stored time is a real instant,
 * and its UTC date can differ from the departure airport's local date for a
 * late-evening departure — the "when did I fly" figures elsewhere resolve
 * that through the airport's timezone. This module deliberately does not: a
 * days-away count that placed one domain on a local clock and the other three
 * on UTC would make the union wrong at exactly the midnights it exists to
 * merge. One clock for all four, and the OpenAPI description says which.
 *
 * ## What is NOT decided here
 *
 * Whether a record counts at all — flown, sailed, checked out, visited — is a
 * counting rule with exactly one home per domain (`shared/flightCounting.ts`,
 * `shared/lodgingCounting.ts`, `shared/placeCounting.ts`, and the sailed
 * predicate the cruise statistics use). The loader applies those and hands
 * this function only the records that passed. This function is pure: dates in,
 * the per-domain counts out, so the overlap arithmetic can be tested without a
 * database.
 *
 * ## Abstention
 *
 * A record with no usable date contributes no day. It is still a flight or a
 * stay that happened — it simply cannot be placed on a calendar, and inventing
 * a day for it would be the placeholder-as-fact defect `shared/lodgingTiming.ts`
 * exists to prevent. The numbers here are counts, so zero is derived, not
 * abstained: an account with no dated record in a domain has zero days away
 * in it.
 */

import { daysBetween } from "../../shared/countryEvidence";

/** A record that names two ends — a flight, a cruise, a stay. Either may be missing. */
export interface DaySpan {
  from: Date | null;
  to: Date | null;
}

/** A record that names one day — a place visit. */
export interface DayPoint {
  at: Date | null;
}

/**
 * The calendar window a scoped summary asks for, as inclusive ISO days.
 * Either bound may be absent. A day outside it contributes nothing, so a
 * stay straddling New Year counts only the days that fall in the year asked
 * for — the same cut a year-scoped flight total makes.
 */
export interface DayWindow {
  from?: string;
  to?: string;
}

export interface DaysAwayInput {
  /** Flights that happened. Departure and arrival instants. */
  flights: readonly DaySpan[];
  /** Cruises that sailed. Start and end dates. */
  cruises: readonly DaySpan[];
  /** Stays that are over. Check-in and check-out days. */
  lodging: readonly DaySpan[];
  /** Visits that happened. */
  places: readonly DayPoint[];
  /**
   * Stations of started roadtrips, each already reduced to the ISO days it
   * attests. Days rather than a span because a station's night decides how
   * many it attests, and that rule lives in `services/stats/roadtripEvidence.ts`.
   */
  roadtrips?: readonly { days: readonly string[] }[];
  /** Counted train rides, each already reduced to its station-local ISO days. */
  rail?: readonly { days: readonly string[] }[];
  /** Counted coach rides, each already reduced to its terminal-local ISO days. */
  bus?: readonly { days: readonly string[] }[];
  /** Counted ferry crossings, each already reduced to its terminal-local ISO days. */
  ferry?: readonly { days: readonly string[] }[];
  window?: DayWindow | null;
}

export interface DaysAway {
  flight: number;
  cruise: number;
  lodging: number;
  place: number;
  roadtrip: number;
  rail: number;
  bus: number;
  ferry: number;
  /** The union of the eight sets above — never their sum. */
  total: number;
}

const isoDay = (at: Date | null): string | null =>
  at !== null && Number.isFinite(at.getTime()) ? at.toISOString().slice(0, 10) : null;

/**
 * A flight attests the two days it names and nothing between them: a red-eye
 * departing on the 3rd and landing on the 4th is two days, a day flight one.
 * Nothing about a flight says the traveller was away on any other day.
 */
const flightDays = (span: DaySpan): string[] => {
  const out: string[] = [];
  const from = isoDay(span.from);
  const to = isoDay(span.to);
  if (from !== null) out.push(from);
  if (to !== null && to !== from) out.push(to);
  return out;
};

/**
 * A cruise or a stay attests its whole span — the record says so. A span with
 * one end missing names only the end it has; `daysBetween` already refuses to
 * count backwards from a check-out typed before its check-in.
 */
const spanDays = (span: DaySpan): string[] => {
  const from = isoDay(span.from);
  const to = isoDay(span.to);
  if (from === null && to === null) return [];
  return daysBetween(from ?? (to as string), to ?? (from as string));
};

const inWindow =
  (window: DayWindow | null | undefined) =>
  (day: string): boolean =>
    (window?.from === undefined || day >= window.from) &&
    (window?.to === undefined || day <= window.to);

export function computeDaysAway(input: DaysAwayInput): DaysAway {
  const keep = inWindow(input.window);
  const collect = (days: string[][]): Set<string> => new Set(days.flat().filter(keep));

  const flight = collect(input.flights.map(flightDays));
  const cruise = collect(input.cruises.map(spanDays));
  const lodging = collect(input.lodging.map(spanDays));
  const place = collect(
    input.places.map((visit) => {
      const day = isoDay(visit.at);
      return day === null ? [] : [day];
    })
  );

  const roadtrip = collect((input.roadtrips ?? []).map((station) => [...station.days]));

  const rail = collect((input.rail ?? []).map((ride) => [...ride.days]));
  const bus = collect((input.bus ?? []).map((ride) => [...ride.days]));
  const ferry = collect((input.ferry ?? []).map((ride) => [...ride.days]));

  return {
    flight: flight.size,
    cruise: cruise.size,
    lodging: lodging.size,
    place: place.size,
    roadtrip: roadtrip.size,
    rail: rail.size,
    bus: bus.size,
    ferry: ferry.size,
    total: new Set([
      ...flight,
      ...cruise,
      ...lodging,
      ...place,
      ...roadtrip,
      ...rail,
      ...bus,
      ...ferry,
    ]).size,
  };
}
