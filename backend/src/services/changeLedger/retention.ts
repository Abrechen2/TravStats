import { prisma } from "../../db";

/**
 * How long the change history is kept (spec §Retention). Default: forever —
 * the point of the ledger is that an old statistic stays explainable, so an
 * instance has to choose to forget. `CHANGE_HISTORY_RETENTION_DAYS` set to a
 * positive whole number prunes rows older than that many days.
 */
export function changeHistoryRetentionDays(
  raw: string | undefined = process.env.CHANGE_HISTORY_RETENTION_DAYS
): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const days = Number(raw);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(
      `CHANGE_HISTORY_RETENTION_DAYS must be a positive whole number of days, got "${raw}"`
    );
  }
  return days;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Delete rows past the horizon; null when the instance keeps everything. */
export async function pruneChangeHistory(
  days: number | null = changeHistoryRetentionDays(),
  now: Date = new Date()
): Promise<number | null> {
  if (days === null) return null;
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const { count } = await prisma.changeLedgerEntry.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
