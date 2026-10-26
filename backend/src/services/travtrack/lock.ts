import type { DbTransaction } from "../../db";

/**
 * One lock per account for everything that writes its TravTrack history:
 * ingest, range delete and zone writes. A delete cannot interleave with an
 * insert and leave a point inside a span the user just deleted, and a point
 * cannot slip in between a zone's count and its delete.
 */
export async function takeTravTrackLock(tx: DbTransaction, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`travtrack:${userId}`}, 0))`;
}
