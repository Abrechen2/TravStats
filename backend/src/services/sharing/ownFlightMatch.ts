import type { DbTransaction } from "../../db";
import { localDay } from "../../shared/time/instant";

/**
 * The recipient's own row of a flight being shared with them. A companion has
 * often logged the flight they took together already; a second row of it made
 * every statistic count the flight twice. Deliberately conservative — a wrong
 * join would hang the sharer's changes on someone's different flight, a missed
 * one only leaves a duplicate the user can delete:
 *
 * - the same flight number (spaces, dashes and leading zeros aside);
 * - the same route, by IATA code (ICAO when a side has none);
 * - the same LOCAL departure day — a flight number repeats every day;
 * - a row of the recipient's that no share has claimed, and not cancelled.
 */

export interface FlightIdentity {
  flightNumber: string | null;
  depIata: string | null;
  depIcao: string | null;
  arrIata: string | null;
  arrIcao: string | null;
  departureTime: Date | null;
  depTimezone: string | null;
}

interface Candidate extends FlightIdentity {
  id: string;
  tripId: string | null;
}

/** A local departure day is the same instant ± 14 hours of offset; two days covers it. */
const WINDOW_MS = 2 * 86_400_000;

export function normalisedFlightNumber(value: string | null): string | null {
  const compact = value?.toUpperCase().replace(/[\s-]+/g, "") ?? "";
  const parts = /^([A-Z0-9]{2})0*(\d{1,4}[A-Z]?)$/.exec(compact);
  return parts ? `${parts[1]}${parts[2]}` : null;
}

const code = (iata: string | null, icao: string | null) =>
  (iata ?? icao)?.trim().toUpperCase() || null;

function departureDay(row: FlightIdentity, zone: string | null): string | null {
  if (!row.departureTime || !zone) return null;
  return localDay(row.departureTime, zone);
}

export function sameFlight(a: FlightIdentity, b: FlightIdentity): boolean {
  const number = normalisedFlightNumber(a.flightNumber);
  if (!number || number !== normalisedFlightNumber(b.flightNumber)) return false;
  const dep = code(a.depIata, a.depIcao);
  const arr = code(a.arrIata, a.arrIcao);
  if (!dep || !arr || dep !== code(b.depIata, b.depIcao) || arr !== code(b.arrIata, b.arrIcao)) {
    return false;
  }
  // Same departure airport, so one zone serves both; a row without one borrows the other's.
  const zone = a.depTimezone ?? b.depTimezone;
  const day = departureDay(a, zone);
  return day !== null && day === departureDay(b, zone);
}

/** The recipient's unclaimed flights near the sharer's departures — the candidates `sameFlight` judges. */
export async function ownFlightCandidates(
  tx: DbTransaction,
  recipientId: string,
  sources: readonly FlightIdentity[]
): Promise<Candidate[]> {
  const times = sources.flatMap((s) => (s.departureTime ? [s.departureTime.getTime()] : []));
  if (times.length === 0) return [];
  return tx.flight.findMany({
    where: {
      userId: recipientId,
      shareKey: null,
      status: { not: "cancelled" },
      flightNumber: { not: null },
      departureTime: {
        gte: new Date(Math.min(...times) - WINDOW_MS),
        lte: new Date(Math.max(...times) + WINDOW_MS),
      },
    },
    select: {
      id: true,
      tripId: true,
      flightNumber: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
      departureTime: true,
      depTimezone: true,
    },
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
  });
}
