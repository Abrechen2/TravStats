import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { localDay, withinKm } from "../../utils/sqlGeo";
import { timezoneOfLodging } from "../../utils/stayInstant";

/**
 * Trip photographs that belong to another entry by WHEN and WHERE they were
 * taken — read at request time, stored nowhere (package 9, item 4).
 *
 *  - a lodging: the user's trip photos taken on a day of one of its stays,
 *    within 500 m of the house, days read in the house's zone;
 *  - a flight: its trip's photos taken between departure and arrival;
 *  - a cruise: its trip's photos taken from embarkation day to the last day;
 *  - a train ride: its trip's photos taken between departure and arrival.
 *
 * Each abstains rather than guesses: a lodging without coordinates, a flight
 * whose times are not real instants, or an entry on no trip shows nothing.
 */

/** "At the hotel": the building, the pool and the street in front of it. */
export const LODGING_PHOTO_RADIUS_KM = 0.5;
/** Photos shown at most; this is a strip on a detail page, not the gallery. */
export const WINDOW_PHOTO_CAP = 48;

export interface WindowPhoto {
  id: string;
  url: string;
  caption: string | null;
  takenAt: string | null;
}

interface Row {
  id: string;
  tripId: string;
  caption: string | null;
  takenAt: Date | null;
}

function toWindowPhoto(row: Row): WindowPhoto {
  return {
    id: row.id,
    url: `/api/v1/trips/${row.tripId}/photos/${row.id}/file`,
    caption: row.caption,
    takenAt: row.takenAt?.toISOString() ?? null,
  };
}

/** The caller's photos (never a cover), newest-last, bounded in SQL. */
async function photosWhere(userId: string, where: Prisma.Sql): Promise<WindowPhoto[]> {
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT ph.id, ph.trip_id AS "tripId", ph.caption, ph.taken_at AS "takenAt"
    FROM trip_photos ph
    JOIN trips t ON t.id = ph.trip_id
    WHERE t.user_id = ${userId}
      AND ph.caption IS DISTINCT FROM '__cover__'
      AND ph.taken_at IS NOT NULL
      AND ${where}
    ORDER BY ph.taken_at ASC
    LIMIT ${WINDOW_PHOTO_CAP}
  `);
  return rows.map(toWindowPhoto);
}

/** Null when the lodging is not the caller's. */
export async function lodgingTripPhotos(
  userId: string,
  lodgingId: string
): Promise<WindowPhoto[] | null> {
  const lodging = await prisma.lodging.findFirst({
    where: { id: lodgingId, userId },
    select: { id: true, lat: true, lon: true },
  });
  if (!lodging) return null;
  if (lodging.lat === null || lodging.lon === null) return [];
  const anchor = { lat: lodging.lat, lon: lodging.lon };
  const tz = timezoneOfLodging(lodging.lat, lodging.lon);
  const day = localDay(Prisma.sql`ph.taken_at`, tz);

  // A stay's check-in and check-out carry the local calendar day already (the
  // same reading the visit-date chips use), so only the photo is converted.
  return photosWhere(
    userId,
    Prisma.sql`
      ph.lat IS NOT NULL AND ph.lon IS NOT NULL
      AND ${withinKm(Prisma.sql`ph.lat`, Prisma.sql`ph.lon`, anchor, LODGING_PHOTO_RADIUS_KM)}
      AND EXISTS (
        SELECT 1 FROM lodging_stays s
        WHERE s.lodging_id = ${lodging.id}
          AND s.user_id = ${userId}
          AND s.check_in IS NOT NULL
          AND s.status <> 'cancelled'
          AND ${day} BETWEEN to_char(s.check_in, 'YYYY-MM-DD')
                         AND to_char(coalesce(s.check_out, s.check_in), 'YYYY-MM-DD')
      )`
  );
}

/**
 * Null when the flight is not the caller's. Only a flight whose both ends are
 * real instants gets photos: a wall clock stored as UTC is hours off, and a
 * window that is hours off shows the wrong pictures with confidence.
 */
export async function flightTripPhotos(
  userId: string,
  flightId: string
): Promise<WindowPhoto[] | null> {
  const flight = await prisma.flight.findFirst({
    where: { id: flightId, userId },
    select: {
      tripId: true,
      departureTime: true,
      arrivalTime: true,
      depTimeSemantics: true,
      arrTimeSemantics: true,
    },
  });
  if (!flight) return null;
  const { tripId, departureTime, arrivalTime } = flight;
  if (!tripId || !departureTime || !arrivalTime) return [];
  if (flight.depTimeSemantics !== "UTC" || flight.arrTimeSemantics !== "UTC") return [];
  return photosWhere(
    userId,
    Prisma.sql`ph.trip_id = ${tripId}
      AND ph.taken_at BETWEEN ${departureTime} AND ${arrivalTime}`
  );
}

/**
 * Null when the cruise is not the caller's. A cruise's dates are days, and a
 * ship keeps no single zone, so the photo's UTC day is compared — the honest
 * reading of what the columns hold.
 */
export async function cruiseTripPhotos(
  userId: string,
  cruiseId: string
): Promise<WindowPhoto[] | null> {
  const cruise = await prisma.cruise.findFirst({
    where: { id: cruiseId, userId },
    select: { tripId: true, startDate: true, endDate: true },
  });
  if (!cruise) return null;
  const { tripId, startDate, endDate } = cruise;
  if (!tripId || !startDate) return [];
  const first = startDate.toISOString().slice(0, 10);
  const last = (endDate ?? startDate).toISOString().slice(0, 10);
  return photosWhere(
    userId,
    Prisma.sql`ph.trip_id = ${tripId}
      AND ${localDay(Prisma.sql`ph.taken_at`, null)} BETWEEN ${first} AND ${last}`
  );
}

/**
 * Null when the ride is not the caller's. A ride's times are real instants
 * once both stations have a zone (the server derives it from where they
 * are); without one, or without an arrival, there is no window to trust —
 * the same abstention the flight makes.
 */
export async function railTripPhotos(
  userId: string,
  railJourneyId: string
): Promise<WindowPhoto[] | null> {
  const ride = await prisma.railJourney.findFirst({
    where: { id: railJourneyId, userId },
    select: {
      tripId: true,
      departureTime: true,
      arrivalTime: true,
      depTimezone: true,
      arrTimezone: true,
    },
  });
  if (!ride) return null;
  const { tripId, departureTime, arrivalTime } = ride;
  if (!tripId || !arrivalTime || !ride.depTimezone || !ride.arrTimezone) return [];
  return photosWhere(
    userId,
    Prisma.sql`ph.trip_id = ${tripId}
      AND ph.taken_at BETWEEN ${departureTime} AND ${arrivalTime}`
  );
}
