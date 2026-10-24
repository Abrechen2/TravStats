import { prisma, type DbTransaction } from "../../db";
import type { EntryKind, EntryRef } from "./classify";

/**
 * Which flights and trips a TravTrack point belongs to (TravTrack plan T2).
 *
 * A link names its entry without a foreign key — one column, two tables. A
 * link to a deleted entry is therefore harmless by construction: every read
 * joins the entry it names and the owner (`linkedPointIds`), and the nightly
 * sweep (`cleanupOrphanLinks`) removes it. Flights are deleted on many paths
 * (the flight route, imports, the XLSX prune, sharing, TravPlan); none of
 * them has to know about TravTrack. The point itself always stays.
 *
 * A trip merge is the one write that moves links (`moveTripLinks`, called in
 * the merge's transaction), because the surviving trip IS the merged one.
 */

const key = (e: EntryRef): string => `${e.kind}:${e.id}`;

/**
 * Each named entry resolved to the entry this account owns, or null. A trip
 * that was merged away resolves to the trip it was merged into, so a phone
 * still holding the old id links to the trip that exists.
 */
export async function resolveEntries(
  tx: DbTransaction,
  userId: string,
  entries: readonly EntryRef[]
): Promise<Map<string, EntryRef | null>> {
  const ids = (kind: EntryKind) => [
    ...new Set(entries.filter((e) => e.kind === kind).map((e) => e.id)),
  ];
  const flightIds = ids("flight");
  const tripIds = ids("trip");
  const [flights, trips, redirects] = await Promise.all([
    flightIds.length
      ? tx.flight.findMany({ where: { userId, id: { in: flightIds } }, select: { id: true } })
      : [],
    tripIds.length
      ? tx.trip.findMany({ where: { userId, id: { in: tripIds } }, select: { id: true } })
      : [],
    tripIds.length
      ? tx.mergedTripRedirect.findMany({
          where: { userId, sourceTripId: { in: tripIds } },
          select: { sourceTripId: true, mergedIntoTripId: true },
        })
      : [],
  ]);
  const ownFlights = new Set(flights.map((f) => f.id));
  const ownTrips = new Set(trips.map((t) => t.id));
  const redirect = new Map(redirects.map((r) => [r.sourceTripId, r.mergedIntoTripId]));
  // A redirect's target is the user's own trip by construction (the merge wrote it).
  const out = new Map<string, EntryRef | null>();
  for (const e of entries) {
    if (e.kind === "flight") {
      out.set(key(e), ownFlights.has(e.id) ? e : null);
    } else if (ownTrips.has(e.id)) {
      out.set(key(e), e);
    } else {
      const to = redirect.get(e.id);
      out.set(key(e), to ? { kind: "trip", id: to } : null);
    }
  }
  return out;
}

export { key as entryKey };

/** Adds links; one that already exists is kept as it is. Never removes one. Returns how many are new. */
export async function addLinks(
  tx: DbTransaction,
  userId: string,
  pairs: ReadonlyArray<{ pointId: string; kind: EntryKind; id: string }>
): Promise<number> {
  if (pairs.length === 0) return 0;
  const { count } = await tx.travTrackPointLink.createMany({
    data: pairs.map((p) => ({ userId, pointId: p.pointId, entryKind: p.kind, entryId: p.id })),
    skipDuplicates: true,
  });
  return count;
}

/** The ids of the points linked to one of this account's entries; none once the entry is gone. */
export async function linkedPointIds(
  userId: string,
  kind: EntryKind,
  entryId: string
): Promise<string[]> {
  const owned =
    kind === "flight"
      ? await prisma.flight.count({ where: { id: entryId, userId } })
      : await prisma.trip.count({ where: { id: entryId, userId } });
  if (owned === 0) return [];
  const rows = await prisma.travTrackPointLink.findMany({
    where: { userId, entryKind: kind, entryId },
    select: { pointId: true },
  });
  return rows.map((r) => r.pointId);
}

/**
 * A trip merge: the source trips' links move to the surviving trip. A point
 * linked to both keeps one link (the primary key would refuse a second).
 * In the merge's transaction, before the source trips are deleted.
 */
export async function moveTripLinks(
  tx: DbTransaction,
  userId: string,
  sourceIds: readonly string[],
  targetId: string
): Promise<void> {
  if (sourceIds.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO travtrack_point_links (user_id, point_id, entry_kind, entry_id, created_at)
    SELECT user_id, point_id, 'trip', ${targetId}, created_at FROM travtrack_point_links
    WHERE user_id = ${userId} AND entry_kind = 'trip' AND entry_id = ANY(${[...sourceIds]})
    ON CONFLICT DO NOTHING`;
  await tx.travTrackPointLink.deleteMany({
    where: { userId, entryKind: "trip", entryId: { in: [...sourceIds] } },
  });
}

/** The nightly sweep: every link whose entry no longer exists for its owner. Returns how many. */
export async function cleanupOrphanLinks(): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM travtrack_point_links l
    WHERE (l.entry_kind = 'flight' AND NOT EXISTS (
            SELECT 1 FROM flights f WHERE f.id = l.entry_id AND f.user_id = l.user_id))
       OR (l.entry_kind = 'trip' AND NOT EXISTS (
            SELECT 1 FROM trips t WHERE t.id = l.entry_id AND t.user_id = l.user_id))`;
}
