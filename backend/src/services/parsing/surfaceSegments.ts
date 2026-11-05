import logger from "../../utils/logger";
import type { ParsedBooking, ParseResult } from "../bookingParser";
import { getCachedAirports } from "../airportCache";
import { classifySurfaceSegment, type SurfaceMode } from "../../shared/surfaceSegment";
import type { ParsedRailBooking, ParsedRailLeg } from "../rail/parser/types";
import { toRailCandidate, type RailImportCandidate } from "../rail/parser/railCandidates";

/**
 * A flight booking's train and bus segments leave the flight list here
 * (owner ruling 2026-11-05, ledger `surface-segments-as-flights`): they come
 * back as a rail booking whose legs the rail review shows, ticked by hand,
 * with the flight number kept as the line's marketing code and the booking
 * reference kept so the ride lands on the same trip as the flights.
 *
 * Nothing is converted without its time. A segment the parser read no clock
 * for stays in the flight list — dropping it would lose it, inventing a
 * departure would put a made-up time on a ride.
 */

export interface SurfaceSplit {
  flights: ParsedBooking[];
  surfaceBookings: RailImportCandidate[];
}

const LOCAL_MINUTE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/;

/** `YYYY-MM-DDTHH:mm` from whatever clock text the parser printed, or null. */
function localMinute(text: string | undefined): string | null {
  const m = text ? LOCAL_MINUTE.exec(text) : null;
  return m ? `${m[1]}T${m[2]}:${m[3]}` : null;
}

function legOf(flight: ParsedBooking, mode: SurfaceMode): ParsedRailLeg | null {
  const departureLocal = localMinute(flight.departureTime);
  const dep = flight.departureCode?.trim().toUpperCase();
  const arr = flight.arrivalCode?.trim().toUpperCase();
  if (!departureLocal || !dep || !arr) return null;
  return {
    // The printed code: the parser reads no station name, and the review asks
    // for the station rather than guessing one from a three-letter code.
    depStationName: dep,
    arrStationName: arr,
    departureLocal,
    arrivalLocal: localMinute(flight.arrivalTime),
    trainCategory: null,
    trainNumber: flight.flightNumber?.trim() || null,
    coach: null,
    seat: flight.seat?.trim() || null,
    direction: null,
    transit: { mode, busKind: mode === "bus" ? "coach" : null },
  };
}

export async function splitSurfaceSegments(
  flights: ParsedBooking[],
  userId?: string
): Promise<SurfaceSplit> {
  const codes = [
    ...new Set(
      flights.flatMap((f) => [f.departureCode, f.arrivalCode]).filter((c): c is string => !!c)
    ),
  ];
  let airports: Map<string, unknown> | null = null;
  try {
    airports = codes.length > 0 ? await getCachedAirports(codes) : new Map();
  } catch (error) {
    // Only the corroborating signal needs the catalogue; the verdict stands without it.
    logger.warn({ operation: "surface_split_airports", error: String(error) });
  }
  const isAirport = (code: string | undefined): boolean | null =>
    code && airports ? airports.has(code.toUpperCase()) : null;

  const kept: ParsedBooking[] = [];
  const groups = new Map<string, { booking: ParsedRailBooking }>();
  for (const flight of flights) {
    const verdict = classifySurfaceSegment({
      aircraft: flight.aircraft,
      airline: flight.airline,
      operatingAirline: flight.operatingAirline,
      departureIsAirport: isAirport(flight.departureCode),
      arrivalIsAirport: isAirport(flight.arrivalCode),
    });
    const leg = verdict ? legOf(flight, verdict.mode) : null;
    if (!verdict || !leg) {
      kept.push(flight);
      continue;
    }
    const reference = flight.bookingReference ?? flight.pnr ?? null;
    const key = reference ?? "";
    const group = groups.get(key) ?? {
      booking: {
        bookingReference: reference,
        travelClass: null,
        tariff: null,
        // The booking's price belongs to the whole flight booking; none of it
        // is assigned to a ground leg.
        price: null,
        currency: null,
        operator: flight.operatingAirline?.trim() || null,
        legs: [],
        source: "flight-booking" as const,
      },
    };
    group.booking.legs.push(leg);
    groups.set(key, group);
  }

  const surfaceBookings: RailImportCandidate[] = [];
  for (const { booking } of groups.values()) {
    surfaceBookings.push(await toRailCandidate(booking, userId));
  }
  return { flights: kept, surfaceBookings };
}

/** The flight parse result with its ground segments moved out. Additive for old clients. */
export async function withoutSurfaceSegments<T extends ParseResult>(
  result: T,
  userId?: string
): Promise<T & { surfaceBookings?: RailImportCandidate[] }> {
  const split = await splitSurfaceSegments(result.flights, userId);
  if (split.surfaceBookings.length === 0) return result;
  return { ...result, flights: split.flights, surfaceBookings: split.surfaceBookings };
}
