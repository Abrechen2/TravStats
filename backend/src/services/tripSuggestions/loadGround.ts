import { prisma } from "../../db";
import { datedPresence, stayPresence, visitPresence } from "../../shared/tripSuggestionRules";
import { ROW_CAP, type Loaded } from "./loadTransport";
import type { PlaceContext, PresenceEntry, PresencePoint } from "./types";

/**
 * Stays, place visits, roadtrips, standalone tours and accepted photo journeys
 * as presence entries — everything that puts the user on the ground somewhere.
 *
 * These carry dates, not instants, so their points sort at conventional hours
 * (see `PresencePoint.hour`). An entry without a coordinate cannot say where the
 * user was and is left out rather than guessed.
 */

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

function daysBetween(startDay: string, endDay: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${startDay}T00:00:00Z`); ; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (day >= endDay) break;
    out.push(day);
  }
  return out;
}

export async function loadStays(userId: string): Promise<Loaded> {
  const rows = await prisma.lodgingStay.findMany({
    where: { userId, checkIn: { not: null } },
    orderBy: [{ checkIn: "asc" }, { id: "asc" }],
    take: ROW_CAP + 1,
    select: {
      id: true,
      tripId: true,
      status: true,
      checkIn: true,
      checkOut: true,
      datePrecision: true,
      nights: true,
      lodging: {
        select: { name: true, city: true, country: true, lat: true, lon: true, visited: true },
      },
    },
  });
  const entries: PresenceEntry[] = [];
  for (const row of rows.slice(0, ROW_CAP)) {
    const { lodging } = row;
    if (lodging.lat === null || lodging.lon === null || !row.checkIn) continue;
    const state = stayPresence(row, lodging.visited);
    if (state === "excluded") continue;
    const startDay = ymd(row.checkIn);
    const endDay = row.checkOut ? ymd(row.checkOut) : startDay;
    const at = { lat: lodging.lat, lon: lodging.lon };
    const points: PresencePoint[] =
      endDay > startDay
        ? [
            { ...at, day: startDay, hour: 15 },
            { ...at, day: endDay, hour: 10 },
          ]
        : [{ ...at, day: startDay, hour: 15 }];
    entries.push({
      key: `lodging:${row.id}`,
      domain: "lodging",
      id: row.id,
      tripId: row.tripId,
      linkable: true,
      state,
      startDay,
      endDay,
      points,
      nights: daysBetween(startDay, endDay),
      label: lodging.name,
      city: lodging.city,
      country: lodging.country,
    });
  }
  return { entries, truncated: rows.length > ROW_CAP };
}

export async function loadPlaceVisits(
  userId: string
): Promise<Loaded & { places: PlaceContext[] }> {
  const [visits, places] = await Promise.all([
    prisma.placeVisit.findMany({
      where: { userId, visitedAt: { not: null } },
      orderBy: [{ visitedAt: "asc" }, { id: "asc" }],
      take: ROW_CAP + 1,
      select: {
        id: true,
        tripId: true,
        visitedAt: true,
        place: { select: { name: true, city: true, country: true, lat: true, lon: true } },
      },
    }),
    prisma.place.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      take: ROW_CAP + 1,
      select: {
        id: true,
        name: true,
        lat: true,
        lon: true,
        visits: { select: { visitedAt: true } },
      },
    }),
  ]);
  const entries: PresenceEntry[] = [];
  for (const row of visits.slice(0, ROW_CAP)) {
    if (!row.visitedAt) continue;
    const day = ymd(row.visitedAt);
    entries.push({
      key: `place:${row.id}`,
      domain: "place",
      id: row.id,
      tripId: row.tripId,
      linkable: true,
      state: visitPresence(row) === "happened" ? "happened" : "planned",
      startDay: day,
      endDay: day,
      points: [{ lat: row.place.lat, lon: row.place.lon, day, hour: 12 }],
      nights: [],
      label: row.place.name,
      city: row.place.city,
      country: row.place.country,
    });
  }
  return {
    entries,
    places: places.slice(0, ROW_CAP).map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      visitDays: p.visits.flatMap((v) => (v.visitedAt ? [ymd(v.visitedAt)] : [])),
    })),
    truncated: visits.length > ROW_CAP || places.length > ROW_CAP,
  };
}

/**
 * Roadtrips (linkable: a roadtrip is the one route kind that moves onto a trip)
 * and standalone tours (presence only — the tour API keeps their points).
 */
export async function loadRoutes(userId: string): Promise<Loaded> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, OR: [{ kind: "roadtrip" }, { kind: "tour", tripId: null }] },
    orderBy: { id: "asc" },
    take: ROW_CAP + 1,
    select: {
      id: true,
      tripId: true,
      kind: true,
      name: true,
      stops: {
        where: { startDate: { not: null }, lat: { not: null }, lon: { not: null } },
        select: {
          title: true,
          startDate: true,
          endDate: true,
          lat: true,
          lon: true,
          overnight: true,
        },
      },
    },
  });
  const entries: PresenceEntry[] = [];
  for (const row of rows.slice(0, ROW_CAP)) {
    const points: PresencePoint[] = [];
    const nights: string[] = [];
    let last: Date | null = null as Date | null;
    for (const stop of row.stops) {
      const start = stop.startDate as Date;
      const end = stop.endDate && stop.endDate > start ? stop.endDate : start;
      const at = { lat: stop.lat as number, lon: stop.lon as number };
      points.push({ ...at, day: ymd(start), hour: 12 });
      if (ymd(end) !== ymd(start)) points.push({ ...at, day: ymd(end), hour: 10 });
      if (row.kind === "roadtrip") {
        const slept = daysBetween(ymd(start), ymd(end));
        nights.push(...(slept.length > 0 ? slept : stop.overnight ? [ymd(start)] : []));
      }
      last = last === null || end > last ? end : last;
    }
    if (points.length === 0 || last === null) continue;
    const days = points.map((p) => p.day).sort();
    const roadtrip = row.kind === "roadtrip";
    entries.push({
      key: `${roadtrip ? "roadtrip" : "tour"}:${row.id}`,
      domain: roadtrip ? "roadtrip" : "tour",
      id: row.id,
      tripId: row.tripId,
      linkable: roadtrip,
      state: datedPresence(last) === "happened" ? "happened" : "planned",
      startDay: days[0],
      endDay: days[days.length - 1],
      points: [...points].sort((a, b) => a.day.localeCompare(b.day) || a.hour - b.hour),
      nights,
      label: row.name,
      city: row.stops[row.stops.length - 1]?.title ?? null,
      country: null,
    });
  }
  return { entries, truncated: rows.length > ROW_CAP };
}

/**
 * Photo journeys the user accepted without recording anything from them — the
 * answer "yes, I was there" with no entry behind it. Presence only. One that
 * created a trip, visit or stay is already present through that entry.
 */
export async function loadAcceptedPhotoJourneys(userId: string): Promise<Loaded> {
  const rows = await prisma.photoJourney.findMany({
    where: {
      userId,
      status: "accepted",
      createdTripId: null,
      createdPlaceVisitId: null,
      createdLodgingStayId: null,
    },
    orderBy: { startDate: "asc" },
    take: ROW_CAP + 1,
    select: {
      id: true,
      startDate: true,
      endDate: true,
      lat: true,
      lon: true,
      city: true,
      countryName: true,
      nights: true,
    },
  });
  const entries = rows.slice(0, ROW_CAP).map((row): PresenceEntry => {
    const startDay = ymd(row.startDate);
    const endDay = ymd(row.endDate);
    return {
      key: `photo:${row.id}`,
      domain: "photo",
      id: row.id,
      tripId: null,
      linkable: false,
      state: "happened",
      startDay,
      endDay,
      points: [
        { lat: row.lat, lon: row.lon, day: startDay, hour: 12 },
        { lat: row.lat, lon: row.lon, day: endDay, hour: 12 },
      ],
      nights: row.nights && row.nights > 0 ? daysBetween(startDay, endDay) : [],
      label: row.city ?? row.countryName ?? "",
      city: row.city,
      country: row.countryName,
    };
  });
  return { entries, truncated: rows.length > ROW_CAP };
}
