import { prisma } from "../../db";
import type { EntryRef } from "../../services/travtrack/classify";

/**
 * The flights and trips each point of a page belongs to — only entries that
 * still exist for their owner. A link to a deleted entry stays in the table
 * until the nightly sweep; it is never shown.
 */
export async function entriesOfPoints(
  userId: string,
  pointIds: readonly string[]
): Promise<Map<string, EntryRef[]>> {
  const out = new Map<string, EntryRef[]>();
  if (pointIds.length === 0) return out;
  const links = await prisma.travTrackPointLink.findMany({
    where: { userId, pointId: { in: [...pointIds] } },
    select: { pointId: true, entryKind: true, entryId: true },
    orderBy: [{ entryKind: "asc" }, { entryId: "asc" }],
  });
  if (links.length === 0) return out;
  const ids = (kind: string) => [
    ...new Set(links.filter((l) => l.entryKind === kind).map((l) => l.entryId)),
  ];
  const [flights, trips] = await Promise.all([
    prisma.flight.findMany({ where: { userId, id: { in: ids("flight") } }, select: { id: true } }),
    prisma.trip.findMany({ where: { userId, id: { in: ids("trip") } }, select: { id: true } }),
  ]);
  const live = new Set([
    ...flights.map((f) => `flight:${f.id}`),
    ...trips.map((t) => `trip:${t.id}`),
  ]);
  for (const l of links) {
    if (!live.has(`${l.entryKind}:${l.entryId}`)) continue;
    const list = out.get(l.pointId) ?? [];
    list.push({ kind: l.entryKind as EntryRef["kind"], id: l.entryId });
    out.set(l.pointId, list);
  }
  return out;
}
