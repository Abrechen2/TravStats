/**
 * The flight rows the flight insights (forgejo#256) read, loaded once and
 * already carrying both ends as `TimeValue`s.
 *
 * One loader for the endpoint, the evidence resolvers and the badges, so the
 * three cannot count different flights: the panel behind "5 new airports in
 * 2024" lists exactly the flights the tile counted, and the "new ground" badge
 * reads the same figure.
 *
 * ## Which flights
 *
 * Every flight that is not cancelled and not a `duplicated` draft. The
 * COUNTING population is narrower (`isCountedRow`: flown and historical, the
 * rule of `shared/flightCounting.ts`) — the wider set is loaded because a
 * booking's transfer verdicts are read over its whole itinerary: a return leg
 * still to fly decides that the outbound's last gap is "another journey", and
 * leaving it out would turn the gap into a connection (`./transfers.ts`).
 *
 * ## The day of each end
 *
 * The departure is filed under the day it left on at its departure airport
 * (`departureDayOf`, the day every flight statistic files it under). The
 * arrival under the day it landed on at the arrival airport, read from the
 * same `TimeValue` the flight's page shows; a flight with no arrival is filed
 * under its departure day for both ends.
 */

import { prisma } from "../../../db";
import { COUNTABLE_FLIGHT_STATUSES } from "../../../shared/flightCounting";
import type { TimeValue } from "../../../shared/time/wire";
import { departureDayOf } from "../../../utils/stats/departureClock";
import type { FlightTimeSemantics } from "../../../utils/timezone";
import { flightTimes, type FlightTimeColumns } from "../../flights/timesDto";
import { buildTzMap, flightEndZone } from "../departureClock";

/** Statuses a booking's itinerary is read over: everything but cancelled and drafts. */
const ITINERARY_STATUSES = [...COUNTABLE_FLIGHT_STATUSES, "scheduled"] as const;

export interface FlightInsightRow {
  id: string;
  flightNumber: string | null;
  status: string;
  /** Read by the year story's fun facts (`calculateFunStats`), nothing else here. */
  airline: string | null;
  seatClass: string | null;
  arrivalTime: Date | null;
  createdAt: Date;
  bookingId: string | null;
  /** IATA, else ICAO, trimmed and upper-cased; null when the end names no airport. */
  depCode: string | null;
  arrCode: string | null;
  depIata: string | null;
  depIcao: string | null;
  arrIata: string | null;
  arrIcao: string | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  departureTime: Date | null;
  /** The departure airport's zone — stored, else the catalogue's (`flightEndZone`). */
  depTimezone: string | null;
  depTimeSemantics: FlightTimeSemantics;
  departure: TimeValue | null;
  arrival: TimeValue | null;
  /** `YYYY-MM-DD` at the departure airport; null without a departure time. */
  departureDay: string | null;
  /** `YYYY-MM-DD` at the arrival airport; the departure day when the arrival is unknown. */
  arrivalDay: string | null;
  /**
   * Is the day of that end a real calendar day (precision `minute` or `day`)?
   * A year-only or unclassified entry (`unknown`) carries a placeholder date,
   * which says the year (or month) at best, never the day. Its 1 January is
   * read as 1 January in every zone (`placeholderDayOf`), so it stays in the
   * year it names.
   */
  departureDayExact: boolean;
  arrivalDayExact: boolean;
}

const isExactDay = (value: TimeValue | null): boolean =>
  value !== null && (value.precision === "minute" || value.precision === "day");

/** Does this row count as a flight that happened (`shared/flightCounting.ts`)? */
export const isCountedRow = (row: Pick<FlightInsightRow, "status">): boolean =>
  (COUNTABLE_FLIGHT_STATUSES as readonly string[]).includes(row.status);

const codeOf = (iata: string | null, icao: string | null): string | null => {
  const code = (iata ?? "").trim() || (icao ?? "").trim();
  return code ? code.toUpperCase() : null;
};

/** The columns the insights read — a full flight row is a superset (the badge check passes one). */
const FLIGHT_INSIGHT_SELECT = {
  id: true,
  flightNumber: true,
  status: true,
  airline: true,
  seatClass: true,
  createdAt: true,
  bookingId: true,
  depIata: true,
  depIcao: true,
  arrIata: true,
  arrIcao: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
  departureTime: true,
  arrivalTime: true,
  depTimeSemantics: true,
  arrTimeSemantics: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
  actualDeparture: true,
  actualArrival: true,
  runwayDepartureTime: true,
  runwayArrivalTime: true,
} as const;

export type FlightInsightSource = FlightTimeColumns & {
  id: string;
  flightNumber: string | null;
  status: string;
  airline: string | null;
  seatClass: string | null;
  createdAt: Date;
  bookingId: string | null;
  depIata: string | null;
  depIcao: string | null;
  arrIata: string | null;
  arrIcao: string | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
};

export async function loadFlightInsightRows(userId: string): Promise<FlightInsightRow[]> {
  const flights = await prisma.flight.findMany({
    where: { userId, status: { in: [...ITINERARY_STATUSES] } },
    select: FLIGHT_INSIGHT_SELECT,
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
  });
  return toFlightInsightRows(flights);
}

/**
 * Flight rows already in memory → insight rows, with no second query of the
 * flight table: the badge check hands over the rows it loaded itself. Only
 * the airport catalogue's zones are asked for (cached), and only for rows
 * that stored none.
 */
export async function toFlightInsightRows(
  flights: readonly FlightInsightSource[]
): Promise<FlightInsightRow[]> {
  if (flights.length === 0) return [];
  const tzMap = await buildTzMap([...flights]);
  return flights.map((f) => {
    const catalogue = {
      dep: flightEndZone(null, tzMap, f.depIata, f.depIcao),
      arr: flightEndZone(null, tzMap, f.arrIata, f.arrIcao),
    };
    const times = flightTimes(f, catalogue);
    const depTimezone = flightEndZone(f.depTimezone, tzMap, f.depIata, f.depIcao);
    const depTimeSemantics = f.depTimeSemantics as FlightTimeSemantics;
    const departureDay = departureDayOf({
      departureTime: f.departureTime,
      depTimezone,
      depTimeSemantics,
    });
    return {
      id: f.id,
      flightNumber: f.flightNumber,
      status: f.status,
      airline: f.airline,
      seatClass: f.seatClass,
      arrivalTime: f.arrivalTime,
      createdAt: f.createdAt,
      bookingId: f.bookingId,
      depCode: codeOf(f.depIata, f.depIcao),
      arrCode: codeOf(f.arrIata, f.arrIcao),
      depIata: f.depIata,
      depIcao: f.depIcao,
      arrIata: f.arrIata,
      arrIcao: f.arrIcao,
      depLat: f.depLat,
      depLon: f.depLon,
      arrLat: f.arrLat,
      arrLon: f.arrLon,
      departureTime: f.departureTime,
      depTimezone,
      depTimeSemantics,
      departure: times.departure,
      arrival: times.arrival,
      departureDay,
      arrivalDay: times.arrival ? times.arrival.local.slice(0, 10) : departureDay,
      departureDayExact: isExactDay(times.departure),
      arrivalDayExact: times.arrival ? isExactDay(times.arrival) : isExactDay(times.departure),
    };
  });
}
