import { prisma, type DbTransaction } from "../../db";
import type { ZoneCircle } from "./classify";
import { clipSpan } from "./gaps";
import { takeTravTrackLock } from "./lock";
import { projectionsOnPointsRemoved } from "./projectionRemoval";
import { narrowOnPointsRemoved } from "./shareNarrow";

/**
 * Deleting a span of the TravTrack history (TravTrack plan T2, review focus
 * 9). Delete is final: the points go (their links cascade), every reported gap
 * overlapping the span is clipped out of it, and the span is remembered as a
 * tombstone so a late upload cannot bring a point — or a gap — back into it.
 * Flights and trips are untouched; nothing is owed anywhere else.
 *
 * Every removal of points — a range here, a privacy zone in `zones.ts` —
 * calls `onPointsRemoved` in its own transaction. The hook is where whatever
 * was derived from the points and handed on (plan T7: a shared trip's route
 * snapshot) is narrowed, so what the user deleted is not kept there either.
 * It only ever takes away: nothing it calls selects points again.
 */

export type PointsRemovedCause =
  { kind: "range"; from: Date; to: Date } | { kind: "zone"; zone: ZoneCircle };

export type PointsRemovedHandler = (
  tx: DbTransaction,
  userId: string,
  cause: PointsRemovedCause
) => Promise<void>;

/**
 * The share snapshots (plan T7) are narrowed by every removal, from the start,
 * and the country days derived from the removed days go with them (plan E6).
 * Listed here rather than registered, so no removal path can run without them.
 */
const handlers: PointsRemovedHandler[] = [narrowOnPointsRemoved, projectionsOnPointsRemoved];

/** Registers a further handler; returns its removal. */
export function registerPointsRemovedHandler(handler: PointsRemovedHandler): () => void {
  handlers.push(handler);
  return () => {
    const at = handlers.indexOf(handler);
    if (at >= 0) handlers.splice(at, 1);
  };
}

/** The one hook every point removal calls, in its transaction. */
export async function onPointsRemoved(
  tx: DbTransaction,
  userId: string,
  cause: PointsRemovedCause
): Promise<void> {
  for (const handler of handlers) await handler(tx, userId, cause);
}

/**
 * Cuts `[from, to)` out of every reported gap that overlaps it: one inside is
 * deleted, one over an edge is shortened, one spanning it is split in two.
 * Returns how many gaps it touched.
 */
async function clipGaps(tx: DbTransaction, userId: string, from: Date, to: Date): Promise<number> {
  const overlapping = await tx.travTrackGap.findMany({
    where: { userId, fromAt: { lt: to }, toAt: { gt: from } },
    select: { id: true, deviceId: true, fromAt: true, toAt: true, reason: true },
  });
  if (overlapping.length === 0) return 0;
  await tx.travTrackGap.deleteMany({ where: { id: { in: overlapping.map((g) => g.id) } } });
  const rest = overlapping.flatMap((g) =>
    clipSpan({ fromMs: g.fromAt.getTime(), toMs: g.toAt.getTime() }, [
      { fromAt: from, toAt: to },
    ]).map((piece) => ({
      userId,
      deviceId: g.deviceId,
      reason: g.reason,
      fromAt: new Date(piece.fromMs),
      toAt: new Date(piece.toMs),
    }))
  );
  if (rest.length > 0) await tx.travTrackGap.createMany({ data: rest, skipDuplicates: true });
  return overlapping.length;
}

export async function deleteTravTrackRange(
  userId: string,
  from: Date,
  to: Date,
  outer?: DbTransaction
): Promise<{ deleted: number; gapsClipped: number }> {
  const run = async (tx: DbTransaction) => {
    await takeTravTrackLock(tx, userId);
    const { count } = await tx.travTrackPoint.deleteMany({
      where: { userId, t: { gte: from, lt: to } },
    });
    const gapsClipped = await clipGaps(tx, userId, from, to);
    await tx.travTrackDeletedRange.create({ data: { userId, fromAt: from, toAt: to } });
    await onPointsRemoved(tx, userId, { kind: "range", from, to });
    return { deleted: count, gapsClipped };
  };
  // Inside a caller's transaction when given one, so its own writes and this commit together.
  return outer ? run(outer) : prisma.$transaction(run, { timeout: 60_000 });
}
