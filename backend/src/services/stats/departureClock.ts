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
import type { FlightTimeSemantics } from "../../utils/timezone";

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
  const map = new Map<string, string>();
  try {
    const airports = await getCachedAirports(Array.from(codes));
    for (const [code, data] of airports.entries()) {
      if (data?.timezone) map.set(code, data.timezone);
    }
  } catch {
    // timezone lookup failed — durations fall back to naïve diff
  }
  return map;
}

/** Attach the departure airport's timezone to each row. */
export async function withDepartureClock<
  T extends {
    depIata: string | null;
    depIcao: string | null;
    arrIata: string | null;
    arrIcao: string | null;
    depTimeSemantics: string;
  },
>(
  rows: T[]
): Promise<Array<T & { depTimezone: string | null; depTimeSemantics: FlightTimeSemantics }>> {
  const tzMap = await buildTzMap(rows);
  return rows.map((f) => ({
    ...f,
    depTimezone:
      (f.depIata ? tzMap.get(f.depIata) : undefined) ??
      (f.depIcao ? tzMap.get(f.depIcao) : undefined) ??
      null,
    depTimeSemantics: f.depTimeSemantics as FlightTimeSemantics,
  }));
}
