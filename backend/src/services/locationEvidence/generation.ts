/**
 * The history generation of an account (TravTrack plan E1, E5's fence;
 * review focus 23): every removal of TravTrack history raises it inside its
 * own transaction, under the per-user TravTrack lock. A derivation captures it
 * before it reads and compares it when it publishes, so a finding read from
 * history that was deleted meanwhile is never published. A rolled-back
 * removal raises nothing.
 */
import type { DbTransaction } from "../../db";
import { takeTravTrackLock } from "../travtrack/lock";

/** The account's generation; 0 while it never removed anything. */
export async function historyGeneration(tx: DbTransaction, userId: string): Promise<bigint> {
  const row = await tx.travTrackDerivationState.findUnique({
    where: { userId },
    select: { historyGeneration: true },
  });
  return row?.historyGeneration ?? 0n;
}

/**
 * Raise the generation by one and answer the new value. Takes the TravTrack
 * lock (re-entrant within a transaction, so a removal already holding it
 * loses nothing).
 */
export async function bumpHistoryGeneration(tx: DbTransaction, userId: string): Promise<bigint> {
  await takeTravTrackLock(tx, userId);
  const row = await tx.travTrackDerivationState.upsert({
    where: { userId },
    create: { userId, historyGeneration: 1n },
    update: { historyGeneration: { increment: 1n } },
    select: { historyGeneration: true },
  });
  return row.historyGeneration;
}
