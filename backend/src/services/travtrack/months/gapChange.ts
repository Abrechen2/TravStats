import type { DbTransaction } from "../../../db";
import { MONTHS_BIT } from "../dirtyDays";
import { takeTravTrackLock } from "../lock";

/**
 * The user's track gap decides where a recording is cut, so every month value
 * built from those cuts is stale the moment it changes (plan: a projection
 * the cut feeds is owed again, never left to disagree with the new setting).
 * Deleted and re-marked in the caller's transaction, like a zone change
 * (`zoneChange.ts`) but for the whole account: the gap reaches every month.
 */
export async function monthsOnTrackGapChanged(tx: DbTransaction, userId: string): Promise<void> {
  await takeTravTrackLock(tx, userId);
  await tx.travTrackMonthValue.deleteMany({ where: { userId } });
  await tx.$executeRaw`
    UPDATE travtrack_dirty_days SET done = done & ~${MONTHS_BIT}::int
     WHERE user_id = ${userId}`;
}
