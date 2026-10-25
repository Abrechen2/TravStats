import { createHash } from "node:crypto";

import type { DbTransaction } from "../../db";
import { positionKey } from "./classify";

/**
 * The tombstones of points deleted one by one (TravTrack plan T5.3, the
 * point inspector's „Punkt löschen"). A single-point delete is final: the
 * ingest every source goes through (Companion, GPX file, Dawarich copy,
 * OwnTracks/Overland) drops a fix whose identity was deleted, so re-importing
 * the same file cannot bring it back.
 *
 * The identity is the ingest's cross-source duplicate key — `positionKey`,
 * the whole second and the exact position — because that is what makes the
 * same fix from another source "the same point". Another fix of the same
 * second at another position has another key and is untouched; a range
 * tombstone would have taken it too. The key is kept only as a digest salted
 * with the account: the deleted point's coordinates are not stored again.
 */

type Position = { tS: number; lat: number; lon: number };

/** The tombstone digest of a fix of this account. */
export const deletedPointDigest = (userId: string, p: Position): string =>
  createHash("sha256")
    .update(`${userId}|${positionKey(p)}`)
    .digest("hex");

/** Records the point as deleted; a second tombstone for the same identity is a no-op. */
export async function rememberDeletedPoint(
  tx: DbTransaction,
  userId: string,
  p: Position
): Promise<void> {
  await tx.travTrackDeletedPoint.createMany({
    data: [{ userId, digest: deletedPointDigest(userId, p), tS: p.tS }],
    skipDuplicates: true,
  });
}

/** The digests of deleted points this batch could hit (within its seconds' extent). */
export async function deletedPointDigests(
  tx: DbTransaction,
  userId: string,
  points: readonly Pick<Position, "tS">[]
): Promise<ReadonlySet<string>> {
  if (points.length === 0) return new Set();
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.tS < min) min = p.tS;
    if (p.tS > max) max = p.tS;
  }
  const rows = await tx.travTrackDeletedPoint.findMany({
    where: { userId, tS: { gte: min, lte: max } },
    select: { digest: true },
  });
  return new Set(rows.map((r) => r.digest));
}
