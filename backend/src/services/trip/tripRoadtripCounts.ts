import { prisma } from "../../db";

/**
 * Adds `_count.roadtrips` to each listed trip: its tour sections of kind
 * `roadtrip`, which the trip page lists as entries (forgejo#169).
 *
 * Prisma's `_count` names a relation and cannot alias a filtered count, and
 * `_count.routes` already means EVERY section (forgejo#90), tours included —
 * so this is one grouped query over the whole page, not one per trip.
 */
export async function withRoadtripCounts<T extends { id: string; _count: object }>(
  trips: T[]
): Promise<Array<T & { _count: T["_count"] & { roadtrips: number } }>> {
  const rows =
    trips.length === 0
      ? []
      : await prisma.tripRoute.groupBy({
          by: ["tripId"],
          where: { tripId: { in: trips.map((t) => t.id) }, kind: "roadtrip" },
          _count: { _all: true },
        });
  const byTrip = new Map(rows.map((r) => [r.tripId, r._count._all]));
  return trips.map((t) => ({ ...t, _count: { ...t._count, roadtrips: byTrip.get(t.id) ?? 0 } }));
}
