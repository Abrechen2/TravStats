import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { bumpHistoryGeneration } from "../locationEvidence/generation";
import { invalidateOnHistoryDeleted } from "../locationEvidence/invalidate";
import type { ZoneCircle } from "./classify";
import { clipSpan } from "./gaps";
import { takeTravTrackLock } from "./lock";
import { projectionsOnPointsRemoved } from "./projectionRemoval";
import { collectRemoved, type RemovedHistory } from "./removedHistory";
import { narrowOnPointsRemoved } from "./shareNarrow";

/**
 * Deleting a span of the TravTrack history (TravTrack plan T2, review focus
 * 9). Delete is final: the points go (their links cascade), every reported gap
 * overlapping the span is clipped out of it, and the span is remembered as a
 * tombstone so a late upload cannot bring a point — or a gap — back into it.
 * Flights and trips are untouched; nothing is owed anywhere else.
 *
 * Every removal of points — a range here (a day delete is one too; its
 * tombstone is the range), a new or grown privacy zone in `zones.ts`, a file
 * import deleted in `imports/fileImport.ts` — calls `onPointsRemoved` in its
 * own transaction, under the TravTrack lock. The hook raises the account's
 * history generation (E5's fence: a scan or an accept that read before this
 * cannot publish after it) and runs every handler: the open findings and
 * questions of the removed history vanish and accepted ones lose their
 * evidence (`locationEvidence/invalidate.ts`, E5), a shared trip's route
 * snapshot is narrowed (plan T7), and the country days of the removed days go
 * back to the projection (E6). It only ever takes away: nothing it calls
 * selects points again. Removing a zone deletes no point and calls nothing.
 */

/**
 * Why points went, and what went (`RemovedHistory`, computed in the
 * transaction BEFORE the delete): `spans`, `days` and `keys`.
 */
export type PointsRemovedCause =
  | ({ kind: "range"; from: Date; to: Date } & RemovedHistory)
  /** A new or grown zone; its circle is in the cause even when it deleted nothing. */
  | ({ kind: "zone"; zone: ZoneCircle } & RemovedHistory)
  /**
   * Every point of one origin went (a file import deleted, plan E8). No
   * tombstone is left, so `keys` lists each removed point (never capped):
   * what a shared route's stored vertices are matched by, so another
   * source's vertex in the same hours stays.
   */
  | ({ kind: "origin"; origin: string; keys: ReadonlySet<string> } & RemovedHistory);

export type PointsRemovedHandler = (
  tx: DbTransaction,
  userId: string,
  cause: PointsRemovedCause
) => Promise<void>;

/**
 * The removal handlers: the open questions of the removed history (E5), the
 * share snapshots (T7) and the country days (E6). Listed here rather than
 * registered, so no removal path can run without them.
 */
const handlers: PointsRemovedHandler[] = [
  invalidateOnHistoryDeleted,
  narrowOnPointsRemoved,
  projectionsOnPointsRemoved,
];

/** Registers a further handler; returns its removal. */
export function registerPointsRemovedHandler(handler: PointsRemovedHandler): () => void {
  handlers.push(handler);
  return () => {
    const at = handlers.indexOf(handler);
    if (at >= 0) handlers.splice(at, 1);
  };
}

/** The one hook every point removal calls, in its transaction, after the delete. */
export async function onPointsRemoved(
  tx: DbTransaction,
  userId: string,
  cause: PointsRemovedCause
): Promise<void> {
  // Re-entrant: the removal holds the lock already; this makes the order explicit.
  await takeTravTrackLock(tx, userId);
  await bumpHistoryGeneration(tx, userId);
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
    const removed = await collectRemoved(tx, userId, Prisma.sql`t >= ${from} AND t < ${to}`);
    const { count } = await tx.travTrackPoint.deleteMany({
      where: { userId, t: { gte: from, lt: to } },
    });
    const gapsClipped = await clipGaps(tx, userId, from, to);
    await tx.travTrackDeletedRange.create({ data: { userId, fromAt: from, toAt: to } });
    await onPointsRemoved(tx, userId, { kind: "range", from, to, ...removed });
    return { deleted: count, gapsClipped };
  };
  // Inside a caller's transaction when given one, so its own writes and this commit together.
  return outer ? run(outer) : prisma.$transaction(run, { timeout: 60_000 });
}
