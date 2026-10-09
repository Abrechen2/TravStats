/**
 * How the network grew (forgejo#256): per year, the connections flown for the
 * first time against the ones flown again. Pure.
 *
 * A connection is the UNORDERED airport pair (`shared/routePair.ts`, the rule
 * of forgejo#254 every other route figure uses): MUC→JFK and JFK→MUC are one
 * connection, so a return flight is a repetition, not a second discovery. A
 * flight with an unknown end is on no connection.
 *
 * The year is the departure's, on the departure airport's calendar. "New"
 * means first flown according to everything recorded — the first recorded
 * year discovers every connection it holds, exactly as for airports.
 */

import { routePairKey } from "../../../shared/routePair";
import type { FlightInsightRow } from "./rows";
import { isCountedRow } from "./rows";

export interface ConnectionFlight {
  connection: string;
  year: number;
  flightId: string;
  day: string;
}

/** The counted, dated flights that are on a connection, oldest first. */
export function connectionFlights(rows: readonly FlightInsightRow[]): ConnectionFlight[] {
  const out: ConnectionFlight[] = [];
  for (const row of rows) {
    if (!isCountedRow(row) || row.departureDay === null) continue;
    const connection = routePairKey(row.depCode, row.arrCode);
    if (connection === null) continue;
    out.push({
      connection,
      year: Number(row.departureDay.slice(0, 4)),
      flightId: row.id,
      day: row.departureDay,
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.flightId.localeCompare(b.flightId));
}

export interface YearConnections {
  year: number;
  /** Connections first flown this year, sorted. */
  discovered: string[];
  /** Connections flown this year that were flown in an earlier year, sorted. */
  repeated: string[];
  flightsOnNew: number;
  flightsOnRepeated: number;
}

/** The first flight on each connection — the evidence behind "new". */
export function firstFlights(flights: readonly ConnectionFlight[]): Map<string, ConnectionFlight> {
  const first = new Map<string, ConnectionFlight>();
  for (const f of flights) if (!first.has(f.connection)) first.set(f.connection, f);
  return first;
}

export function connectionsByYear(flights: readonly ConnectionFlight[]): YearConnections[] {
  const first = firstFlights(flights);
  const years = new Map<number, YearConnections>();
  for (const f of flights) {
    const row = years.get(f.year) ?? {
      year: f.year,
      discovered: [],
      repeated: [],
      flightsOnNew: 0,
      flightsOnRepeated: 0,
    };
    const isNew = first.get(f.connection)!.year === f.year;
    const list = isNew ? row.discovered : row.repeated;
    if (!list.includes(f.connection)) list.push(f.connection);
    if (isNew) row.flightsOnNew += 1;
    else row.flightsOnRepeated += 1;
    years.set(f.year, row);
  }
  return [...years.values()]
    .sort((a, b) => a.year - b.year)
    .map((row) => ({ ...row, discovered: row.discovered.sort(), repeated: row.repeated.sort() }));
}
