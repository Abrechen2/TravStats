/**
 * Transfer times (forgejo#256): how long the traveller waited between two
 * flights of one booking, per year and as a record. Pure.
 *
 * ## Which gaps are transfers
 *
 * Only segments the user LINKED: two flights of one booking (`bookingId`),
 * walked in stored departure order. Two flights that merely happen to be
 * close in time are never paired — a return the next morning or someone
 * else's flight copied into the log would read as a "connection".
 *
 * The verdict for each gap is `shared/flightTransfer.ts` — the rule the
 * booking page draws with, mirrored on the web and pinned by
 * `shared/flight/transferVectors.json`. A wait is measured only between two
 * instants known to the minute and only where the order of the segments is
 * certain; it is a transfer only when the next flight leaves within 24 hours
 * of the landing and does not fly back to where the journey already was.
 *
 * Both flights must be `flown`: the clocks of a `historical` entry are often a
 * placeholder (`shared/flightCounting.ts`, "the second cut"), and a scheduled
 * flight has not happened. Such a gap is counted in `coverage.notFlown`, every
 * other gap that yields no wait under its own reason — never as zero minutes.
 */

import {
  segmentTransfers,
  transferAirportRef,
  type FlightTransfer,
  type ResolvedTransferSegment,
} from "../../../shared/flightTransfer";
import type { FlightInsightRow } from "./rows";

export interface MeasuredTransfer {
  minutes: number;
  /** The airport landed at; null when the arriving flight names none. */
  airport: string | null;
  /** Set when the next flight leaves from ANOTHER airport. */
  airportChange: { from: string; to: string; km: number | null } | null;
  /** The landing's local day at the connecting airport. */
  day: string;
  arrivingFlightId: string;
  departingFlightId: string;
  arrivingFlightNumber: string | null;
  departingFlightNumber: string | null;
}

export interface TransferCoverage {
  /** Bookings with at least two segments to compare. */
  bookings: number;
  /** Consecutive segment pairs looked at. */
  gaps: number;
  measured: number;
  unknownTime: number;
  unknownOrder: number;
  conflict: number;
  separate: number;
  notFlown: number;
}

export interface TransferFold {
  transfers: MeasuredTransfer[];
  coverage: TransferCoverage;
}

function segmentOf(row: FlightInsightRow): ResolvedTransferSegment {
  return {
    departure: row.departure,
    arrival: row.arrival,
    from: transferAirportRef(row.depIata, row.depIcao, row.depLat, row.depLon),
    to: transferAirportRef(row.arrIata, row.arrIcao, row.arrLat, row.arrLon),
  };
}

const departureMs = (row: FlightInsightRow): number =>
  row.departureTime ? row.departureTime.getTime() : Number.POSITIVE_INFINITY;

/** Stored departure order — the order the booking page walks them in. */
function byStoredDeparture(a: FlightInsightRow, b: FlightInsightRow): number {
  return departureMs(a) - departureMs(b) || a.id.localeCompare(b.id);
}

function tally(coverage: TransferCoverage, verdict: FlightTransfer): TransferCoverage {
  switch (verdict.kind) {
    case "unknown":
      return verdict.reason === "time"
        ? { ...coverage, unknownTime: coverage.unknownTime + 1 }
        : { ...coverage, unknownOrder: coverage.unknownOrder + 1 };
    case "conflict":
      return { ...coverage, conflict: coverage.conflict + 1 };
    case "separate":
      return { ...coverage, separate: coverage.separate + 1 };
    default:
      return coverage;
  }
}

export function foldTransfers(rows: readonly FlightInsightRow[]): TransferFold {
  const bookings = new Map<string, FlightInsightRow[]>();
  for (const row of rows) {
    if (!row.bookingId) continue;
    bookings.set(row.bookingId, [...(bookings.get(row.bookingId) ?? []), row]);
  }
  let coverage: TransferCoverage = {
    bookings: 0,
    gaps: 0,
    measured: 0,
    unknownTime: 0,
    unknownOrder: 0,
    conflict: 0,
    separate: 0,
    notFlown: 0,
  };
  const transfers: MeasuredTransfer[] = [];
  for (const segments of bookings.values()) {
    if (segments.length < 2) continue;
    const ordered = [...segments].sort(byStoredDeparture);
    const verdicts = segmentTransfers(ordered.map(segmentOf));
    coverage = { ...coverage, bookings: coverage.bookings + 1 };
    verdicts.forEach((verdict, i) => {
      const arriving = ordered[i];
      const departing = ordered[i + 1];
      coverage = { ...coverage, gaps: coverage.gaps + 1 };
      if (arriving.status !== "flown" || departing.status !== "flown") {
        coverage = { ...coverage, notFlown: coverage.notFlown + 1 };
        return;
      }
      if (verdict.kind !== "transfer") {
        coverage = tally(coverage, verdict);
        return;
      }
      coverage = { ...coverage, measured: coverage.measured + 1 };
      transfers.push({
        minutes: verdict.minutes,
        airport: arriving.arrCode,
        airportChange:
          verdict.airport.kind === "change"
            ? { from: verdict.airport.from, to: verdict.airport.to, km: verdict.airport.km }
            : null,
        // A transfer exists only between two minute-precise instants, so the
        // landing's local day is always known here.
        day: arriving.arrival!.local.slice(0, 10),
        arrivingFlightId: arriving.id,
        departingFlightId: departing.id,
        arrivingFlightNumber: arriving.flightNumber,
        departingFlightNumber: departing.flightNumber,
      });
    });
  }
  transfers.sort(
    (a, b) => a.day.localeCompare(b.day) || a.arrivingFlightId.localeCompare(b.arrivingFlightId)
  );
  return { transfers, coverage };
}

export interface YearTransfers {
  year: number;
  count: number;
  totalMinutes: number;
  /** The middle wait (the lower middle of an even count); never an average dragged by one overnight. */
  medianMinutes: number;
  shortest: MeasuredTransfer;
  longest: MeasuredTransfer;
}

const byMinutes = (a: MeasuredTransfer, b: MeasuredTransfer): number =>
  a.minutes - b.minutes ||
  a.day.localeCompare(b.day) ||
  a.arrivingFlightId.localeCompare(b.arrivingFlightId);

export function shortestAndLongest(transfers: readonly MeasuredTransfer[]): {
  shortest: MeasuredTransfer | null;
  longest: MeasuredTransfer | null;
} {
  const sorted = [...transfers].sort(byMinutes);
  return { shortest: sorted[0] ?? null, longest: sorted[sorted.length - 1] ?? null };
}

export function transfersByYear(transfers: readonly MeasuredTransfer[]): YearTransfers[] {
  const years = new Map<number, MeasuredTransfer[]>();
  for (const t of transfers) {
    const year = Number(t.day.slice(0, 4));
    years.set(year, [...(years.get(year) ?? []), t]);
  }
  return [...years.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, list]) => {
      const sorted = [...list].sort(byMinutes);
      return {
        year,
        count: sorted.length,
        totalMinutes: sorted.reduce((sum, t) => sum + t.minutes, 0),
        medianMinutes: sorted[Math.floor((sorted.length - 1) / 2)].minutes,
        shortest: sorted[0],
        longest: sorted[sorted.length - 1],
      };
    });
}
