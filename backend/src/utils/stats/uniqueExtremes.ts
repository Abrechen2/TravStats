import { calculateDistance } from "../geo";
import { tzAwareDurationMinutes, type FlightTimeSemantics } from "../timezone";
import { departureClockOf } from "./departureClock";
import {
  arrivalEndpointCode,
  arrivalTimezoneOf,
  departureEndpointCode,
  departureTimezoneOf,
  localArrivalDay,
} from "./flightPredicates";
import type { AirportData } from "../../services/airportLookup";
import type { FlightData } from "./types";
import { type HomePeriod, isHomeAirportAt } from "../homeAirport";

/**
 * The record-like tiles of "Einzigartiges" (`calculateUniqueStats`), each
 * returned WITH the flights that decided it (forgejo#256).
 *
 * Moved out of `uniqueStats.ts` unchanged in their rules, so the tile and the
 * evidence panel behind it (`services/evidence/metricEvidenceFlightWitnesses.ts`)
 * read one calculation: the flights the panel lists are the ones the figure
 * was taken from, not a second search for something that looks like it.
 */

/** Max duration counted as a "layover". Anything longer is a stopover / trip gap. */
export const LAYOVER_CAP_HOURS = 24;

/** A flight with both clocks — the time-sensitive subset of the tiles. */
export type ClockedFlight = FlightData & { departureTime: Date; arrivalTime: Date };

const byDeparture = (a: ClockedFlight, b: ClockedFlight): number =>
  a.departureTime.getTime() - b.departureTime.getTime();

export interface AirportExtreme {
  code: string;
  flightIds: string[];
}

/**
 * Highest airport by catalogue altitude. The first airport to reach the
 * highest altitude in the catalogue's order wins, as before; its witnesses
 * are the flights that start or end there.
 */
export function highestAirportOf(
  flights: readonly FlightData[],
  airports: ReadonlyMap<string, AirportData>
): (AirportExtreme & { name: string; altitude: number }) | null {
  let best: { code: string; name: string; altitude: number } | null = null;
  for (const [code, airport] of airports.entries()) {
    if (airport && airport.altitude != null && (!best || airport.altitude > best.altitude)) {
      best = { code, name: airport.name || code, altitude: airport.altitude };
    }
  }
  if (!best) return null;
  const code = best.code;
  const flightIds = flights
    .filter((f) => departureEndpointCode(f) === code || arrivalEndpointCode(f) === code)
    .map((f) => f.id);
  return { ...best, flightIds };
}

/**
 * Northernmost / southernmost END of any flight, by its stored latitude. The
 * first end to reach the extreme wins the code; every flight with an end at
 * that latitude and code is a witness.
 */
export function latitudeExtremeOf(
  flights: readonly FlightData[],
  direction: "north" | "south"
): (AirportExtreme & { lat: number }) | null {
  const better = (a: number, b: number): boolean => (direction === "north" ? a > b : a < b);
  let best: { lat: number; code: string } | null = null;
  const ends = (f: FlightData) => [
    { lat: f.depLat, code: f.depIata || f.depIcao || "?" },
    { lat: f.arrLat, code: f.arrIata || f.arrIcao || "?" },
  ];
  for (const f of flights) {
    for (const end of ends(f)) {
      if (end.lat != null && (!best || better(end.lat, best.lat))) best = end;
    }
  }
  if (!best) return null;
  const found = best;
  const flightIds = flights
    .filter((f) => ends(f).some((e) => e.lat === found.lat && e.code === found.code))
    .map((f) => f.id);
  return { ...found, flightIds };
}

/**
 * Longest run of consecutive flights, each departing from where the previous
 * one landed within 24 hours. The first longest run wins.
 */
export function longestTravelChainOf(flights: readonly ClockedFlight[]): {
  length: number;
  flightIds: string[];
} {
  if (flights.length === 0) return { length: 0, flightIds: [] };
  const sorted = [...flights].sort(byDeparture);
  let best: ClockedFlight[] = [sorted[0]];
  let run: ClockedFlight[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevArrCode = prev.arrIata || prev.arrIcao;
    const currDepCode = curr.depIata || curr.depIcao;
    const hours = (curr.departureTime.getTime() - prev.arrivalTime.getTime()) / 3_600_000;
    if (prevArrCode && currDepCode && prevArrCode === currDepCode && hours >= 0 && hours <= 24) {
      run = [...run, curr];
    } else {
      if (run.length > best.length) best = run;
      run = [curr];
    }
  }
  if (run.length > best.length) best = run;
  return { length: best.length, flightIds: best.map((f) => f.id) };
}

/**
 * Highest average ground speed, great-circle distance over the time-zone-aware
 * duration. Flights under 30 minutes and speeds over 1200 km/h are taken for
 * bad data; DATE_ONLY rows have no duration and take no part.
 */
export function fastestRouteOf(
  flights: readonly ClockedFlight[],
  timezoneMap: ReadonlyMap<string, string>
): { route: string; speed: number; flightIds: string[] } | null {
  let best: { route: string; speed: number; flightId: string } | null = null;
  for (const f of flights) {
    if (f.depLat == null || f.depLon == null || f.arrLat == null || f.arrLon == null) continue;
    const distance = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    // Deliberately NOT the stored `duration_minutes` column (forgejo#45): the
    // tournament has always measured `tzAwareDurationMinutes` on the selected
    // semantics, and reading the column would silently drop flights out of it.
    const durationMinutes = tzAwareDurationMinutes(
      f.departureTime,
      f.arrivalTime,
      departureTimezoneOf(f, timezoneMap as Map<string, string>),
      arrivalTimezoneOf(f, timezoneMap as Map<string, string>),
      (f as { depTimeSemantics?: FlightTimeSemantics }).depTimeSemantics,
      (f as { arrTimeSemantics?: FlightTimeSemantics }).arrTimeSemantics
    );
    const durationHours = durationMinutes === null ? 0 : durationMinutes / 60;
    if (durationHours <= 0.5) continue;
    const speed = distance / durationHours;
    if (speed <= 1200 && (!best || speed > best.speed)) {
      best = {
        route: `${f.depIata || f.depIcao || "?"}-${f.arrIata || f.arrIcao || "?"}`,
        speed: Math.round(speed),
        flightId: f.id,
      };
    }
  }
  return best ? { route: best.route, speed: best.speed, flightIds: [best.flightId] } : null;
}

/**
 * The calendar day (at the departure airport) whose flights touched the most
 * countries, by the catalogue's country of each end. The first day to reach
 * the maximum wins; its flights are the witnesses.
 */
export function mostCountriesInDayOf(
  flights: readonly ClockedFlight[],
  airports: ReadonlyMap<string, AirportData>
): { count: number; date: string | null; flightIds: string[] } {
  const byDate = new Map<string, ClockedFlight[]>();
  for (const f of flights) {
    const date = departureClockOf(f)?.date;
    if (!date) continue;
    byDate.set(date, [...(byDate.get(date) ?? []), f]);
  }
  let best = { count: 0, date: null as string | null, flightIds: [] as string[] };
  for (const [date, dayFlights] of byDate) {
    const countries = new Set<string>();
    for (const f of dayFlights) {
      for (const code of [departureEndpointCode(f), arrivalEndpointCode(f)]) {
        const country = code ? airports.get(code)?.country : undefined;
        if (country) countries.add(country);
      }
    }
    if (countries.size > best.count) {
      best = { count: countries.size, date, flightIds: dayFlights.map((f) => f.id) };
    }
  }
  return best;
}

export interface Layover {
  hours: number;
  from: string;
  to: string;
  /** The landing and the next departure — a layover is TWO flights. */
  flightIds: [string, string];
}

/**
 * Longest and shortest wait between two consecutive flights at the same
 * airport, capped at `LAYOVER_CAP_HOURS`, with every home airport active on
 * the landing's local day excluded (forgejo#273). Hours rounded to a tenth;
 * the first to reach a rounded extreme wins.
 */
export function layoverExtremesOf(
  flights: readonly ClockedFlight[],
  timezoneMap: ReadonlyMap<string, string>,
  homePeriods: readonly HomePeriod[]
): { longest: Layover | null; shortest: Layover | null } {
  let longest: Layover | null = null;
  let shortest: Layover | null = null;
  const sorted = [...flights].sort(byDeparture);
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const from = current.arrIata || current.arrIcao || "?";
    const to = next.depIata || next.depIcao || "?";
    if (from !== to) continue;
    const arrivalDay = localArrivalDay(current, timezoneMap as Map<string, string>);
    if (isHomeAirportAt(homePeriods, arrivalDay, from)) continue;
    const hours = (next.departureTime.getTime() - current.arrivalTime.getTime()) / 3_600_000;
    if (hours <= 0 || hours > LAYOVER_CAP_HOURS) continue;
    const entry: Layover = {
      hours: Math.round(hours * 10) / 10,
      from,
      to,
      flightIds: [current.id, next.id],
    };
    if (!longest || entry.hours > longest.hours) longest = entry;
    if (!shortest || entry.hours < shortest.hours) shortest = entry;
  }
  return { longest, shortest };
}

/**
 * Northern-hemisphere seasons reached by a departure month (on the departure
 * airport's clock): spring Mar–May, summer Jun–Aug, autumn Sep–Nov, winter
 * Dec–Feb. Every flight with a departure month is a witness.
 */
export function seasonsReachedOf(flights: readonly FlightData[]): {
  seasons: number;
  flightIds: string[];
} {
  const seasons = new Set<number>();
  const flightIds: string[] = [];
  for (const f of flights) {
    const clock = departureClockOf(f);
    if (!clock) continue;
    flightIds.push(f.id);
    const month = clock.month;
    if (month >= 2 && month <= 4) seasons.add(0);
    else if (month >= 5 && month <= 7) seasons.add(1);
    else if (month >= 8 && month <= 10) seasons.add(2);
    else seasons.add(3);
  }
  return { seasons: seasons.size, flightIds };
}
