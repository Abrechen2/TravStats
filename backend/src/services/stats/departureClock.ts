/**
 * The departure airport's clock, attached to flight rows.
 *
 * The flight table stores instants; the clock a departure happened on lives on
 * the airport. Every "when did I fly" figure — time of day, weekday, month,
 * which calendar day or year a flight belongs to — has to be read on that
 * clock, so it travels with the row into the stats modules (#266) rather than
 * each of them resolving it, or forgetting to.
 *
 * Lifted out of `routes/stats.ts` unchanged when the passport loader moved into
 * this directory: the loader needs the same resolution, and a service reaching
 * back into a route for it would be a cycle. Behaviour is identical — this is a
 * move, not a rewrite.
 */

import { getCachedAirports } from "../airportCache";
import { localWallClockOf, type FlightTimeSemantics } from "../../utils/timezone";
import logger from "../../utils/logger";

/**
 * The columns a flight's clock is read from — the airport codes the catalogue
 * answers for, the semantics tag, and the zones the flight was STORED with.
 * Spread into every statistics select, so no reader can forget the stored
 * zones and fall back to today's catalogue (ADR 0002 phase 4).
 */
export const FLIGHT_CLOCK_SELECT = {
  depIata: true,
  depIcao: true,
  arrIata: true,
  arrIcao: true,
  depTimeSemantics: true,
  depTimezone: true,
  arrTimezone: true,
} as const;

/**
 * The zone one end of a flight is read in: the zone it was written with
 * (frozen since ADR 0002 phase 2, backfilled in 3b) — so a catalogue
 * correction no longer moves which day or year a past flight counts in — and
 * only for a row that stored none, today's catalogue zone by IATA, then ICAO.
 */
export function flightEndZone(
  stored: string | null | undefined,
  tzMap: ReadonlyMap<string, string>,
  iata: string | null,
  icao: string | null
): string | null {
  return (
    stored || (iata ? tzMap.get(iata) : undefined) || (icao ? tzMap.get(icao) : undefined) || null
  );
}

/**
 * A UTC-timezone map for a set of flight rows (mirrors computeSummary).
 *
 * Exported as well as used below, because a duration needs the ARRIVAL clock
 * too and `withDepartureClock` deliberately carries only the departure one.
 */
export async function buildTzMap(
  rows: Array<{
    depIata: string | null;
    depIcao: string | null;
    arrIata: string | null;
    arrIcao: string | null;
  }>
): Promise<Map<string, string>> {
  const codes = new Set<string>();
  for (const f of rows) {
    if (f.depIata) codes.add(f.depIata);
    if (f.depIcao) codes.add(f.depIcao);
    if (f.arrIata) codes.add(f.arrIata);
    if (f.arrIcao) codes.add(f.arrIcao);
  }
  let map = new Map<string, string>();
  try {
    map = tzMapFromAirports(await getCachedAirports(Array.from(codes)));
  } catch (error) {
    // Durations fall back to a naive diff and a row without a stored zone is
    // read in UTC — logged, so a broken catalogue is not a silent shift.
    logger.warn({ operation: "departure_clock_catalogue_failed", error });
  }
  return map;
}

/**
 * The code → zone map `flightEndZone` reads, from an airport map the caller has
 * already loaded for its own purposes (a country, a continent) — so a figure
 * that needs both does not ask the catalogue twice.
 */
export function tzMapFromAirports(
  airports: ReadonlyMap<string, { timezone?: string | null } | null | undefined>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [code, data] of airports.entries()) {
    if (data?.timezone) map.set(code, data.timezone);
  }
  return map;
}

/** Attach the departure's zone to each row — stored first, see `flightEndZone`. */
export async function withDepartureClock<
  T extends {
    depIata: string | null;
    depIcao: string | null;
    arrIata: string | null;
    arrIcao: string | null;
    depTimeSemantics: string;
    /** The stored zone; absent from a select that predates it (then the catalogue answers). */
    depTimezone?: string | null;
  },
>(
  rows: T[]
): Promise<Array<T & { depTimezone: string | null; depTimeSemantics: FlightTimeSemantics }>> {
  const tzMap = await buildTzMap(rows);
  return rows.map((f) => ({
    ...f,
    depTimezone: flightEndZone(f.depTimezone, tzMap, f.depIata, f.depIcao),
    depTimeSemantics: f.depTimeSemantics as FlightTimeSemantics,
  }));
}

/**
 * The calendar day an instant fell on AT A GIVEN AIRPORT, as UTC midnight.
 *
 * The one home for "which day was that, locally". Kept here beside
 * `buildTzMap` because every caller that needs it has already resolved a
 * timezone through this module: the timeseries buckets on it, and the travel
 * account decides on it whether a flight took a night (AUD-079).
 *
 * UTC midnight is a carrier, not a claim about the zone — it makes days
 * comparable and subtractable without a second timezone conversion.
 *
 * @deprecated → `localDay` in `shared/time` (ADR 0002), once flights store
 * their zone (phase 3); reads through `localWallClockOf`, which converts
 * through `shared/time` already. Deleted in phase 6.
 */
export function airportCalendarDay(
  stored: Date,
  timezone: string | null,
  semantics: FlightTimeSemantics
): Date {
  return new Date(`${localWallClockOf(stored, timezone, semantics).date}T00:00:00Z`);
}
