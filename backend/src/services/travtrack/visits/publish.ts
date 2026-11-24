import { prisma, type DbTransaction } from "../../../db";
import { stayScanAllowed } from "../../dawarich/stays/availability";
import { historyGeneration } from "../../locationEvidence/generation";
import { travTrackInstanceOnIn } from "../availability";
import { takeTravTrackLock } from "../lock";

export type Published = "created" | "duplicate" | "stale" | "revoked";

/** One transaction under the TravTrack lock: still permitted, history unchanged, then the write. */
export async function publish(
  userId: string,
  generation: bigint,
  write: (tx: DbTransaction) => Promise<Published>
): Promise<Published> {
  return prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    const owned = await tx.dawarichStayScan.findFirst({
      where: { userId, enabled: true, ...stayScanAllowed(true, "travtrack") },
      select: { userId: true },
    });
    if (!owned || !(await travTrackInstanceOnIn(tx))) return "revoked";
    if ((await historyGeneration(tx, userId)) !== generation) return "stale";
    return write(tx);
  });
}
