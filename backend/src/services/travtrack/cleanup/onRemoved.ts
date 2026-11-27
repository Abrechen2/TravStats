import type { DbTransaction } from "../../../db";
import type { PointsRemovedCause } from "../deleteRange";
import { privacyCut } from "../privacyCut";

/**
 * The removal handler of the road-matched stretches (rc46 extras C2,
 * security review): a matched line is drawn from the points it was matched
 * from, so it goes when they go — in the same transaction as the delete.
 *
 * - range, origin, point: every match whose span overlaps a removed span is
 *   deleted (a match is never clipped: what is left would be a line the
 *   remaining points never produced);
 * - a new or grown zone: every match whose line enters the circle is deleted,
 *   whether or not a stored point lay inside it.
 */
export async function cleanupOnPointsRemoved(
  tx: DbTransaction,
  userId: string,
  cause: PointsRemovedCause
): Promise<void> {
  const rows = await tx.travTrackCleanup.findMany({
    where: { userId, kind: "mapMatch" },
    select: { id: true, fromMs: true, untilMs: true, geometry: true },
  });
  const gone = rows.filter((r) => {
    const from = Number(r.fromMs);
    const until = Number(r.untilMs);
    if (cause.spans.some(([a, b]) => a < until && b >= from)) return true;
    if (cause.kind !== "zone") return false;
    const lines = Array.isArray(r.geometry) ? (r.geometry as [number, number][][]) : [];
    const cut = privacyCut(lines, [cause.zone]);
    return JSON.stringify(cut) !== JSON.stringify(lines.filter((l) => l.length > 1));
  });
  if (gone.length > 0) {
    await tx.travTrackCleanup.deleteMany({ where: { id: { in: gone.map((r) => r.id) } } });
  }
}
