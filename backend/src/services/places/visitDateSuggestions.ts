import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { localDay, withinKm } from "../../utils/sqlGeo";
import { timezoneOfLodging } from "../../utils/stayInstant";

/**
 * Dates a visit to a place could carry, read from the user's own logbook.
 *
 * Three kinds of evidence, in the order the chips show them:
 *  - a chosen trip's stays and arrivals near the place — or, when none of them
 *    is near, the trip's days themselves;
 *  - with no trip chosen, the most recent past stay and the most recent past
 *    arrival near the place;
 *  - days on which the user took photographs within a few hundred metres.
 *
 * A candidate is only a candidate: the form offers it as a chip and never
 * writes it. Every source abstains rather than flooding the form — a stay or a
 * trip longer than `MAX_SPAN_DAYS` names no day at all, because thirty chips
 * say "somewhere in this month", which the user knew already.
 */

/** "Near" for a stay or an arrival airport: the day trip from the hotel. */
export const NEARBY_ENTRY_KM = 50;
/** "Here" for a photograph: close enough that it shows the place, not the town. */
export const PHOTO_RADIUS_KM = 0.3;
/** Longest stay or trip whose days are still worth offering one by one. */
export const MAX_SPAN_DAYS = 14;
/** Photo days offered at most — the busiest ones. */
export const PHOTO_DAY_CAP = 8;
/** Nearby stays and arrivals read inside a chosen trip. */
const TRIP_ENTRY_CAP = 10;

export type VisitDateSource = "trip" | "stay" | "flight" | "photo";

export interface VisitDateSuggestion {
  /** Calendar day, `YYYY-MM-DD`, at the place. */
  date: string;
  source: VisitDateSource;
  /** Trip or lodging name, or the arrival airport; null for photographs. */
  label: string | null;
  /** Photographs taken near the place on that day; null when none were. */
  photoCount: number | null;
}

interface PlaceAnchor {
  id: string;
  lat: number;
  lon: number;
}

/** Every day from `start` to `end` inclusive, or null past `MAX_SPAN_DAYS`. */
export function daysBetween(start: string, end: string): string[] | null {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [start];
  const count = Math.round((to - from) / 86_400_000) + 1;
  if (count > MAX_SPAN_DAYS) return null;
  return Array.from({ length: count }, (_, i) =>
    new Date(from + i * 86_400_000).toISOString().slice(0, 10)
  );
}

interface StayRow {
  checkIn: string;
  checkOut: string | null;
  name: string;
}

interface ArrivalRow {
  day: string;
  label: string | null;
}

/**
 * Stays near the place. `tripId` narrows to that trip; without it only stays
 * that have begun count — "the last time you were near here" is a past fact.
 */
async function nearbyStays(
  userId: string,
  p: PlaceAnchor,
  tripId: string | null,
  take: number
): Promise<StayRow[]> {
  const scope = tripId
    ? Prisma.sql`AND s.trip_id = ${tripId}`
    : Prisma.sql`AND s.check_in <= now()`;
  return prisma.$queryRaw<StayRow[]>(Prisma.sql`
    SELECT to_char(s.check_in, 'YYYY-MM-DD') AS "checkIn",
           to_char(s.check_out, 'YYYY-MM-DD') AS "checkOut",
           l.name
    FROM lodging_stays s
    JOIN lodgings l ON l.id = s.lodging_id AND l.user_id = ${userId}
    WHERE s.user_id = ${userId}
      AND s.check_in IS NOT NULL
      AND s.status <> 'cancelled'
      AND l.lat IS NOT NULL AND l.lon IS NOT NULL
      AND ${withinKm(Prisma.sql`l.lat`, Prisma.sql`l.lon`, p, NEARBY_ENTRY_KM)}
      ${scope}
    ORDER BY s.check_in DESC
    LIMIT ${take}
  `);
}

/**
 * Arrivals at an airport near the place, dated in the place's zone. A row that
 * stores a wall clock rather than an instant (`LEGACY_FAKE_UTC`), or only a
 * day (`DATE_ONLY`), already carries the local day and is not shifted again.
 */
async function nearbyArrivals(
  userId: string,
  p: PlaceAnchor,
  tz: string | null,
  tripId: string | null,
  take: number
): Promise<ArrivalRow[]> {
  const scope = tripId
    ? Prisma.sql`AND f.trip_id = ${tripId}`
    : Prisma.sql`AND coalesce(f.arrival_time, f.departure_time) <= now()`;
  const when = Prisma.sql`coalesce(f.arrival_time, f.departure_time)`;
  return prisma.$queryRaw<ArrivalRow[]>(Prisma.sql`
    SELECT CASE
             WHEN f.arr_time_semantics IN ('LEGACY_FAKE_UTC', 'DATE_ONLY')
               THEN to_char(${when}, 'YYYY-MM-DD')
             ELSE ${localDay(when, tz)}
           END AS day,
           coalesce(f.arr_iata, f.arr_icao, f.arr_name) AS label
    FROM flights f
    WHERE f.user_id = ${userId}
      AND f.status <> 'cancelled'
      AND ${when} IS NOT NULL
      AND ${withinKm(Prisma.sql`f.arr_lat`, Prisma.sql`f.arr_lon`, p, NEARBY_ENTRY_KM)}
      ${scope}
    ORDER BY ${when} DESC
    LIMIT ${take}
  `);
}

/** Days with photographs taken at the place, busiest first. */
async function photoDays(
  userId: string,
  p: PlaceAnchor,
  tz: string | null
): Promise<Array<{ day: string; n: number }>> {
  return prisma.$queryRaw<Array<{ day: string; n: number }>>(Prisma.sql`
    SELECT day, count(*)::int AS n
    FROM (
      SELECT ${localDay(Prisma.sql`ph.taken_at`, tz)} AS day
      FROM trip_photos ph
      JOIN trips t ON t.id = ph.trip_id
      WHERE t.user_id = ${userId}
        AND ph.taken_at IS NOT NULL
        AND ph.lat IS NOT NULL AND ph.lon IS NOT NULL
        AND ${withinKm(Prisma.sql`ph.lat`, Prisma.sql`ph.lon`, p, PHOTO_RADIUS_KM)}
    ) days
    GROUP BY day
    ORDER BY n DESC, day DESC
    LIMIT ${PHOTO_DAY_CAP}
  `);
}

function stayDays(rows: StayRow[]): VisitDateSuggestion[] {
  return rows.flatMap((row) =>
    (daysBetween(row.checkIn, row.checkOut ?? row.checkIn) ?? []).map((date) => ({
      date,
      source: "stay" as const,
      label: row.name,
      photoCount: null,
    }))
  );
}

function arrivalDays(rows: ArrivalRow[]): VisitDateSuggestion[] {
  return rows.map((row) => ({
    date: row.day,
    source: "flight",
    label: row.label,
    photoCount: null,
  }));
}

/** Days suggested by the logbook entries — trip-scoped or most recent. */
async function entryDays(
  userId: string,
  p: PlaceAnchor,
  tz: string | null,
  tripId: string | null
): Promise<VisitDateSuggestion[]> {
  if (!tripId) {
    const [stays, arrivals] = await Promise.all([
      nearbyStays(userId, p, null, 1),
      nearbyArrivals(userId, p, tz, null, 1),
    ]);
    return [...stayDays(stays), ...arrivalDays(arrivals)];
  }

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { name: true, startDate: true, endDate: true },
  });
  // A trip that is not the caller's is treated as no trip at all — the
  // nearby-entry branch would then answer from the whole logbook, which is not
  // what the form asked, so it answers nothing instead.
  if (!trip) return [];

  const [stays, arrivals] = await Promise.all([
    nearbyStays(userId, p, tripId, TRIP_ENTRY_CAP),
    nearbyArrivals(userId, p, tz, tripId, TRIP_ENTRY_CAP),
  ]);
  const near = [...stayDays(stays), ...arrivalDays(arrivals)];
  if (near.length > 0) return near;

  if (!trip.startDate) return [];
  const start = trip.startDate.toISOString().slice(0, 10);
  const end = (trip.endDate ?? trip.startDate).toISOString().slice(0, 10);
  return (daysBetween(start, end) ?? []).map((date) => ({
    date,
    source: "trip" as const,
    label: trip.name,
    photoCount: null,
  }));
}

/**
 * The suggestions for one of the caller's places, or null when the place is
 * not theirs. Days already carrying a visit to this place are left out: a chip
 * for a day that is recorded offers a duplicate, not help.
 */
export async function visitDateSuggestionsFor(
  userId: string,
  placeId: string,
  tripId: string | null
): Promise<VisitDateSuggestion[] | null> {
  const place = await prisma.place.findFirst({
    where: { id: placeId, userId },
    select: {
      id: true,
      lat: true,
      lon: true,
      visits: { where: { visitedAt: { not: null } }, select: { visitedAt: true } },
    },
  });
  if (!place) return null;

  const tz = timezoneOfLodging(place.lat, place.lon);
  const [entries, photos] = await Promise.all([
    entryDays(userId, place, tz, tripId),
    photoDays(userId, place, tz),
  ]);

  const recorded = new Set(place.visits.map((v) => v.visitedAt!.toISOString().slice(0, 10)));
  const byDate = new Map<string, VisitDateSuggestion>();
  for (const s of entries) {
    if (!recorded.has(s.date) && !byDate.has(s.date)) byDate.set(s.date, s);
  }
  for (const { day, n } of photos) {
    if (recorded.has(day)) continue;
    const existing = byDate.get(day);
    byDate.set(
      day,
      existing
        ? { ...existing, photoCount: n }
        : { date: day, source: "photo", label: null, photoCount: n }
    );
  }
  return [...byDate.values()];
}
