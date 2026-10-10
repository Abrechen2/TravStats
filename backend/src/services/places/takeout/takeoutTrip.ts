import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { resolveCountryCode, ISO_3166_1_ALPHA2 } from "../../../shared/geo/countryCode";
import { toCountryCode } from "../../../shared/countryEvidence";
import { zoneOf } from "../../../shared/time/zoneOf";
import { localDay, withinKm } from "../../../utils/sqlGeo";
import {
  airportFactsFor,
  cruiseCountriesByTrip,
  lodgingCountriesByTrip,
  roadtripCountriesByTrip,
  tripCountries,
} from "../../../routes/trips/tripCountries";
import { PHOTO_RADIUS_KM } from "../visitDateSuggestions";
import { TRIP_SPAN_SELECT, tripSpan } from "../visitTrip";
import type { DayReason, TakeoutTrip, TripReason } from "../../../schemas/placeImportResolve";

/**
 * The trip and the day a Takeout row belongs to (#358, points 2 and 3).
 *
 * Takeout names each list's file after the list, and people name lists after
 * where they went: "Japan", "Norwegen 2024". Such a list maps to the user's
 * ONE trip into that country — none, or several, is a question for the user,
 * never a heuristic's pick (the same rule as `visitTrip.ts`).
 *
 * The day comes from the user's own trip photographs: taken inside that trip's
 * span, within `PHOTO_RADIUS_KM` of the place — the radius the visit-date chips
 * and the photo suggestions already use, so "here" means one thing. Measured by
 * hand on a real export, 216 of 240 sights got a day this way.
 */

/** A stay this close to the saved hotel is that hotel. */
const STAY_RADIUS_KM = 0.5;

const ISO = new Set(ISO_3166_1_ALPHA2);

/**
 * The country a list is named after, as ISO alpha-2, or null.
 *
 * `.csv` and a trailing year are dropped ("Norwegen 2024.csv" → NO). A name of
 * two letters is NOT read as a code: "Go" and "Me" are words before they are
 * Montenegro — a list called "To do" must not become a trip.
 */
export function countryOfListName(listName: string | null | undefined): string | null {
  if (!listName) return null;
  const cleaned = listName
    .replace(/\.csv$/i, "")
    .replace(/[\s_\-–(]*\(?\d{2,4}\)?\s*$/, "")
    .replace(/_/g, " ")
    .trim();
  if (cleaned.length < 3) return null;
  const code = resolveCountryCode(cleaned);
  return code && ISO.has(code) ? code : null;
}

export interface TripMatch {
  trip: TakeoutTrip | null;
  reason: TripReason | null;
}

/** The user's single trip into `countryCode`, by the trip pages' own country rule. */
export async function soleTripIntoCountry(
  userId: string,
  countryCode: string | null
): Promise<TripMatch> {
  if (!countryCode) return { trip: null, reason: "no_country" };

  const trips = await prisma.trip.findMany({
    where: { userId, status: { not: "cancelled" } },
    select: {
      ...TRIP_SPAN_SELECT,
      countries: true,
      flights: {
        where: { status: { not: "cancelled" } },
        select: { depIata: true, arrIata: true },
      },
    },
    take: 500,
  });
  const ids = trips.map((t) => t.id);
  const [facts, cruise, lodging, roadtrip] = await Promise.all([
    airportFactsFor(trips.flatMap((t) => t.flights)),
    cruiseCountriesByTrip(ids),
    lodgingCountriesByTrip(ids),
    roadtripCountriesByTrip(ids),
  ]);

  const into = trips.filter((t) =>
    tripCountries(
      t.countries,
      t.flights,
      facts,
      cruise.get(t.id) ?? [],
      lodging.get(t.id) ?? [],
      roadtrip.get(t.id) ?? []
    ).some((c) => toCountryCode(c) === countryCode)
  );
  if (into.length === 0) return { trip: null, reason: "no_trip" };
  if (into.length > 1) return { trip: null, reason: "several_trips" };

  const only = into[0];
  const span = tripSpan(only);
  return {
    trip: { id: only.id, name: only.name, first: span?.first ?? null, last: span?.last ?? null },
    reason: null,
  };
}

export interface DayAnswer {
  visitDay: { date: string; photoCount: number } | null;
  reason: DayReason | null;
}

/**
 * The day the user's photographs say they were at the place, inside the trip.
 * The busiest day wins; two days with the same count is `ambiguous` — a coin
 * toss presented as a date is the thing "abstention is a result" forbids.
 */
export async function photoVisitDay(
  userId: string,
  trip: TakeoutTrip | null,
  position: { lat: number; lon: number } | null
): Promise<DayAnswer> {
  if (!trip || !trip.first || !trip.last) return { visitDay: null, reason: "no_trip" };
  if (!position) return { visitDay: null, reason: "no_position" };

  const tz = zoneOf(position);
  const day = localDay(Prisma.sql`ph.taken_at`, tz);
  const rows = await prisma.$queryRaw<Array<{ day: string; n: number }>>(Prisma.sql`
    SELECT day, count(*)::int AS n
    FROM (
      SELECT ${day} AS day
      FROM trip_photos ph
      JOIN trips t ON t.id = ph.trip_id
      WHERE t.user_id = ${userId}
        AND ph.caption IS DISTINCT FROM '__cover__'
        AND ph.taken_at IS NOT NULL
        AND ph.lat IS NOT NULL AND ph.lon IS NOT NULL
        AND ${withinKm(Prisma.sql`ph.lat`, Prisma.sql`ph.lon`, position, PHOTO_RADIUS_KM)}
    ) days
    WHERE day BETWEEN ${trip.first} AND ${trip.last}
    GROUP BY day
    ORDER BY n DESC, day ASC
    LIMIT 2
  `);
  if (rows.length === 0) return { visitDay: null, reason: "no_photos" };
  if (rows.length > 1 && rows[1].n === rows[0].n) return { visitDay: null, reason: "ambiguous" };
  return { visitDay: { date: rows[0].day, photoCount: rows[0].n }, reason: null };
}

/** The trip's one stay at this spot, or null for none or several. */
export async function stayAtPosition(
  userId: string,
  tripId: string,
  position: { lat: number; lon: number }
): Promise<{ id: string; name: string; checkIn: string | null } | null> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; checkIn: string | null }>
  >(Prisma.sql`
    SELECT s.id, l.name, to_char(s.check_in, 'YYYY-MM-DD') AS "checkIn"
    FROM lodging_stays s
    JOIN lodgings l ON l.id = s.lodging_id AND l.user_id = ${userId}
    WHERE s.user_id = ${userId}
      AND s.trip_id = ${tripId}
      AND s.status <> 'cancelled'
      AND l.lat IS NOT NULL AND l.lon IS NOT NULL
      AND ${withinKm(Prisma.sql`l.lat`, Prisma.sql`l.lon`, position, STAY_RADIUS_KM)}
    LIMIT 2
  `);
  return rows.length === 1 ? rows[0] : null;
}
