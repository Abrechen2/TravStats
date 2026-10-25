import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { Prisma } from "../../prisma";
import { positionKey } from "./classify";
import { onPointsRemoved } from "./deleteRange";
import { takeTravTrackLock } from "./lock";
import { rememberDeletedPoint } from "./deletedPoints";
import { collectRemoved } from "./removedHistory";

/**
 * Deleting ONE point of the TravTrack history by its id (TravTrack plan T5.3,
 * the map's point inspector). Exactly that row goes — never every fix sharing
 * its instant, which a span `[t, t + 1 ms)` would take with it — and its links
 * cascade. It is a removal like any other: under the TravTrack lock and in one
 * transaction, `onPointsRemoved` raises the history generation and runs every
 * handler (E5's invalidation of the findings resting on it, the share
 * snapshots losing exactly this vertex, the country days, explored cells and
 * monthly values of its day and neighbours going back to the projections and
 * those days marked dirty).
 *
 * Final: the point leaves a tombstone of its own identity (`deletedPoints.ts`)
 * so no source brings it back — not a range, which would hide the other fixes
 * of the instant too. Another account's point, or one already gone, is 404 —
 * the same answer, so an id cannot be probed.
 */

const notFound = () => new AppError("No such point", 404, "TRAVTRACK_POINT_NOT_FOUND");

export async function deleteTravTrackPoint(
  userId: string,
  pointId: string
): Promise<{ deleted: number }> {
  return prisma.$transaction(
    async (tx) => {
      await takeTravTrackLock(tx, userId);
      const row = await tx.travTrackPoint.findFirst({
        where: { id: pointId, userId },
        select: { id: true, tS: true, lat: true, lon: true },
      });
      if (!row) throw notFound();
      const removed = await collectRemoved(tx, userId, Prisma.sql`id = ${row.id}`);
      const { count } = await tx.travTrackPoint.deleteMany({ where: { id: row.id, userId } });
      if (count === 0) throw notFound();
      await rememberDeletedPoint(tx, userId, row);
      await onPointsRemoved(tx, userId, {
        kind: "point",
        pointId: row.id,
        ...removed,
        // Exactly this point, whatever `collectRemoved`'s cap would say.
        keys: new Set([positionKey(row)]),
      });
      return { deleted: count };
    },
    { timeout: 60_000 }
  );
}
