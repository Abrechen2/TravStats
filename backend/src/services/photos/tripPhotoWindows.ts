import { prisma } from "../../db";
import { rideHasClocks } from "../../shared/railClock";
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
  /** Where it was taken; null when the photo stores no position (forgejo#132 item 11). */
  lat: number | null;
  lon: number | null;
}

/**
 * The rule that found the photos, so a client can say it ("am Tag des
 * Aufenthalts, im Umkreis von 500 m") instead of guessing it (forgejo#132
 * item 10). `instant` ranges are ISO instants; `localDay` and `utcDay` ranges
 * are calendar days, inclusive — read in `timeZone`, or in UTC for `utcDay`.
 */
export interface PhotoWindow {
  basis: "instant" | "localDay" | "utcDay";
  ranges: Array<{ from: string; to: string }>;
  timeZone: string | null;
  /** Lodging only: how far from `center` a photo may have been taken. */
  radiusKm: number | null;
  center: { lat: number; lon: number } | null;
}

/**
 * Why an entry has no window — it shows nothing rather than guessing.
 * `noClock`: a train ride logged date-only (forgejo#132 item 17) — a whole
 * day of photos is not "taken on the train".
 */
export type WindowAbstention =
  "notOnTrip" | "noCoordinates" | "noDates" | "notRealInstants" | "noClock";

export interface WindowResult {
  photos: WindowPhoto[];
  /** Every photo the window matches; more than `photos.length` when capped. */
  total: number;
  limit: number;
  window: PhotoWindow | null;
  reason: WindowAbstention | null;
}

interface Row {
  id: string;
  tripId: string;
  caption: string | null;
  takenAt: Date | null;
  lat: number | null;
  lon: number | null;
  total: bigint;
}

function toWindowPhoto(row: Row): WindowPhoto {
  return {
    id: row.id,
    url: `/api/v1/trips/${row.tripId}/photos/${row.id}/file`,
    caption: row.caption,
    takenAt: row.takenAt?.toISOString() ?? null,
    lat: row.lat,
    lon: row.lon,
  };
}

function abstain(reason: WindowAbstention): WindowResult {
  return { photos: [], total: 0, limit: WINDOW_PHOTO_CAP, window: null, reason };
}

const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The caller's photos (never a cover), newest-last, bounded in SQL. The total
 * is counted in the same query (`COUNT(*) OVER ()` runs before the LIMIT), so
 * "alle 48" is never said of a window that holds more.
 */
async function photosWhere(
  userId: string,
  where: Prisma.Sql,
  window: PhotoWindow
): Promise<WindowResult> {
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT ph.id, ph.trip_id AS "tripId", ph.caption, ph.taken_at AS "takenAt",
           ph.lat, ph.lon, COUNT(*) OVER () AS total
    FROM trip_photos ph
    JOIN trips t ON t.id = ph.trip_id
    WHERE t.user_id = ${userId}
      AND ph.caption IS DISTINCT FROM '__cover__'
      AND ph.taken_at IS NOT NULL
      AND ${where}
    ORDER BY ph.taken_at ASC
    LIMIT ${WINDOW_PHOTO_CAP}
  `);
  return {
    photos: rows.map(toWindowPhoto),
    total: rows.length > 0 ? Number(rows[0].total) : 0,
    limit: WINDOW_PHOTO_CAP,
    window,
    reason: null,
  };
}

const instantWindow = (from: Date, to: Date): PhotoWindow => ({
  basis: "instant",
  ranges: [{ from: from.toISOString(), to: to.toISOString() }],
  timeZone: null,
  radiusKm: null,
  center: null,
});

/** Null when the lodging is not the caller's. */
export async function lodgingTripPhotos(
  userId: string,
  lodgingId: string
): Promise<WindowResult | null> {
  const lodging = await prisma.lodging.findFirst({
    where: { id: lodgingId, userId },
    select: { id: true, lat: true, lon: true },
  });
  if (!lodging) return null;
  if (lodging.lat === null || lodging.lon === null) return abstain("noCoordinates");
  const anchor = { lat: lodging.lat, lon: lodging.lon };
  const tz = timezoneOfLodging(lodging.lat, lodging.lon);
  const day = localDay(Prisma.sql`ph.taken_at`, tz);
  const stays = await prisma.lodgingStay.findMany({
    where: { lodgingId: lodging.id, userId, checkIn: { not: null }, status: { not: "cancelled" } },
    select: { checkIn: true, checkOut: true },
    orderBy: { checkIn: "asc" },
  });
  const window: PhotoWindow = {
    basis: tz ? "localDay" : "utcDay",
    ranges: stays.flatMap((s) =>
      s.checkIn ? [{ from: dayOf(s.checkIn), to: dayOf(s.checkOut ?? s.checkIn) }] : []
    ),
    timeZone: tz,
    radiusKm: LODGING_PHOTO_RADIUS_KM,
    center: anchor,
  };

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
      )`,
    window
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
): Promise<WindowResult | null> {
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
  if (!tripId) return abstain("notOnTrip");
  if (!departureTime || !arrivalTime) return abstain("noDates");
  if (flight.depTimeSemantics !== "UTC" || flight.arrTimeSemantics !== "UTC") {
    return abstain("notRealInstants");
  }
  return photosWhere(
    userId,
    Prisma.sql`ph.trip_id = ${tripId}
      AND ph.taken_at BETWEEN ${departureTime} AND ${arrivalTime}`,
    instantWindow(departureTime, arrivalTime)
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
): Promise<WindowResult | null> {
  const cruise = await prisma.cruise.findFirst({
    where: { id: cruiseId, userId },
    select: { tripId: true, startDate: true, endDate: true },
  });
  if (!cruise) return null;
  const { tripId, startDate, endDate } = cruise;
  if (!tripId) return abstain("notOnTrip");
  if (!startDate) return abstain("noDates");
  const first = dayOf(startDate);
  const last = dayOf(endDate ?? startDate);
  return photosWhere(
    userId,
    Prisma.sql`ph.trip_id = ${tripId}
      AND ${localDay(Prisma.sql`ph.taken_at`, null)} BETWEEN ${first} AND ${last}`,
    {
      basis: "utcDay",
      ranges: [{ from: first, to: last }],
      timeZone: null,
      radiusKm: null,
      center: null,
    }
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
): Promise<WindowResult | null> {
  const ride = await prisma.railJourney.findFirst({
    where: { id: railJourneyId, userId },
    select: {
      tripId: true,
      departureTime: true,
      arrivalTime: true,
      depTimezone: true,
      arrTimezone: true,
      depPrecision: true,
      arrPrecision: true,
    },
  });
  if (!ride) return null;
  const { tripId, departureTime, arrivalTime } = ride;
  if (!tripId) return abstain("notOnTrip");
  if (!rideHasClocks(ride)) return abstain("noClock");
  if (!arrivalTime) return abstain("noDates");
  if (!ride.depTimezone || !ride.arrTimezone) return abstain("notRealInstants");
  return photosWhere(
    userId,
    Prisma.sql`ph.trip_id = ${tripId}
      AND ph.taken_at BETWEEN ${departureTime} AND ${arrivalTime}`,
    instantWindow(departureTime, arrivalTime)
  );
}
