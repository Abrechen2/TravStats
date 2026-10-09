import { prisma } from "../../db";
import { classifyVisit } from "../../shared/placeCounting";

/** A named thing that hangs off a place — a list it is in, a trip a visit is filed under. */
export interface NamedRef {
  id: string;
  name: string;
}

/**
 * Everything that hangs off one place, counted — what a delete takes with it
 * and what a merge moves (forgejo#232, forgejo#250).
 *
 * Counted on the server in one round of queries rather than pieced together by
 * the client from a visit list (which the list endpoint does not carry photos
 * for) and one document request per visit. Every figure is the caller's own:
 * the place is looked up by owner first, and nothing below can reach another
 * account's rows through it.
 */
export interface PlaceRelations {
  /** Every visit row, planned ones included — a delete takes them all. */
  visitCount: number;
  /** Of those, still in the future (`shared/placeCounting`). */
  plannedVisitCount: number;
  /** Proof photographs on its visits. */
  photoCount: number;
  /** Kept originals (tickets, receipts) filed against its visits. */
  documentCount: number;
  /** Own lists and subscribed checklists the place is in. */
  lists: NamedRef[];
  /** Trips its visits are filed under — they survive a delete. */
  trips: NamedRef[];
  /** Roadtrip stations that name the place — they survive too (SetNull). */
  roadtripStationCount: number;
}

export async function placeRelations(
  userId: string,
  placeId: string,
  now = new Date()
): Promise<PlaceRelations | null> {
  const place = await prisma.place.findFirst({
    where: { id: placeId, userId },
    select: { id: true },
  });
  if (!place) return null;

  const [visits, photoCount, documentCount, entries, roadtripStationCount] = await Promise.all([
    prisma.placeVisit.findMany({
      where: { placeId, userId },
      select: { visitedAt: true, trip: { select: { id: true, name: true } } },
    }),
    prisma.placeVisitPhoto.count({ where: { visit: { placeId, userId } } }),
    prisma.document.count({ where: { userId, placeVisit: { placeId } } }),
    prisma.placeListEntry.findMany({
      where: { placeId, list: { userId } },
      select: { list: { select: { id: true, name: true } } },
      orderBy: { list: { name: "asc" } },
    }),
    prisma.tripStop.count({ where: { placeId } }),
  ]);

  const trips = new Map<string, NamedRef>();
  for (const v of visits) if (v.trip) trips.set(v.trip.id, v.trip);

  return {
    visitCount: visits.length,
    plannedVisitCount: visits.filter((v) => classifyVisit(v, now) === "planned").length,
    photoCount,
    documentCount,
    lists: entries.map((e) => e.list),
    trips: [...trips.values()].sort((a, b) => a.name.localeCompare(b.name)),
    roadtripStationCount,
  };
}
