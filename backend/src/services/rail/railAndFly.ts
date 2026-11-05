import { prisma } from "../../db";
import { calculateDistance } from "../../utils/geo";
import { classifySurfaceSegment } from "../../shared/surfaceSegment";

/**
 * Rail&Fly (owner ruling 2026-11-05, ledger `rail-and-fly`): a real train
 * ticket is tied to the flight it feeds. The link is made ONLY when a ticket
 * is imported — the flight booking alone proposes nothing, because it carries
 * no ride to tie to.
 *
 * A ride belongs to a flight when
 * - it is a train ride (not a tram) with a ticket behind it;
 * - they are on the same trip, where both name one;
 * - the ride's day lies within one day of the flight's day on the matching
 *   side: a ride that ENDS near the departure airport feeds the flight's
 *   departure day, a ride that STARTS near the arrival airport carries the
 *   traveller home from the flight's arrival day;
 * - that end of the ride is within `RAIL_AND_FLY_MAX_KM` of the airport.
 *
 * With several candidates the closest wins (day distance, then kilometres); a
 * tie names none — a link to the wrong flight is worse than no link
 * (abstention is a result). Nothing here edits an existing link: re-saving a
 * ride never re-derives it.
 */

/** Far enough for a city station that is served by the airport's rail link. */
export const RAIL_AND_FLY_MAX_KM = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The query window: the day rule allows one day either side of a flight day. */
const WINDOW_MS = 3 * DAY_MS;

export interface RailAndFlyRide {
  tripId: string | null;
  departureTime: Date;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
}

export interface RailAndFlyFlight {
  id: string;
  tripId: string | null;
  departureTime: Date | null;
  arrivalTime: Date | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
}

const utcDay = (d: Date): number => Math.floor(d.getTime() / DAY_MS);
const hasPosition = (lat: number, lon: number): boolean => !(lat === 0 && lon === 0);

/** The id of the one flight the ride feeds, or null. Pure — the rule above. */
export function pickRailAndFlyFlight(
  ride: RailAndFlyRide,
  flights: readonly RailAndFlyFlight[]
): string | null {
  const rideDay = utcDay(ride.departureTime);
  const matches: { id: string; days: number; km: number }[] = [];
  for (const flight of flights) {
    if (ride.tripId && flight.tripId && ride.tripId !== flight.tripId) continue;
    // Outbound: the ride ends at the departure airport, on the departure day.
    if (flight.departureTime && hasPosition(flight.depLat, flight.depLon)) {
      const days = Math.abs(rideDay - utcDay(flight.departureTime));
      const km = calculateDistance(ride.arrLat, ride.arrLon, flight.depLat, flight.depLon);
      if (days <= 1 && km <= RAIL_AND_FLY_MAX_KM) matches.push({ id: flight.id, days, km });
    }
    // Return: the ride starts at the arrival airport, on the arrival day.
    const arrivalDay = flight.arrivalTime ?? flight.departureTime;
    if (arrivalDay && hasPosition(flight.arrLat, flight.arrLon)) {
      const days = Math.abs(rideDay - utcDay(arrivalDay));
      const km = calculateDistance(ride.depLat, ride.depLon, flight.arrLat, flight.arrLon);
      if (days <= 1 && km <= RAIL_AND_FLY_MAX_KM) matches.push({ id: flight.id, days, km });
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.days - b.days || a.km - b.km);
  const [best, next] = matches;
  // Two matches on one flight (a round trip within a day) are still one flight.
  if (next && next.id !== best.id && next.days === best.days && next.km === best.km) return null;
  return best.id;
}

/** Looks the user's flights up and applies the rule. Null when none qualifies. */
export async function findRailAndFlyFlight(
  userId: string,
  ride: RailAndFlyRide
): Promise<string | null> {
  const from = new Date(ride.departureTime.getTime() - WINDOW_MS);
  const to = new Date(ride.departureTime.getTime() + WINDOW_MS);
  const rows = await prisma.flight.findMany({
    where: {
      userId,
      status: { not: "cancelled" },
      OR: [{ departureTime: { gte: from, lte: to } }, { arrivalTime: { gte: from, lte: to } }],
    },
    select: {
      id: true,
      tripId: true,
      departureTime: true,
      arrivalTime: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      aircraft: true,
      airline: true,
      operatingAirline: true,
    },
  });
  // A ground segment stored as a flight is no flight to feed.
  const flights = rows.filter(
    (f) =>
      !classifySurfaceSegment({
        aircraft: f.aircraft,
        airline: f.airline,
        operatingAirline: f.operatingAirline,
      })
  );
  return pickRailAndFlyFlight(ride, flights);
}
