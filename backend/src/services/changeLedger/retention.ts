import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import {
  DEFAULT_RETENTION_MONTHS,
  RETENTION_MONTHS_OPTIONS,
  type RetentionMonths,
} from "./retentionPolicy";

/** Rows deleted per statement: a short transaction, so a write never waits long behind it. */
export const PRUNE_BATCH_SIZE = 2000;
/** Breathing room between batches, so the nightly pass never monopolises the table. */
const PAUSE_MS = 50;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `months` back from `now`, on the calendar (Postgres' own interval arithmetic would differ at month ends). */
export function retentionCutoff(months: number, now: Date): Date {
  // Clamp the day to the target month's last day: a bare setUTCMonth turns
  // 31 March − 1 month into 3 March, and the prune deleted three days of history
  // still inside the window (review, rc.45).
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(now.getUTCDate(), lastDay),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds()
    )
  );
}

/**
 * Delete every ledger row older than its account's window, a bounded batch at a
 * time. Per window length the scan is `created_at < cutoff` (indexed) restricted
 * to the accounts that chose it; accounts without a settings row use the default.
 * Returns the number of rows deleted.
 */
export async function pruneChangeHistory(
  now: Date = new Date(),
  batchSize: number = PRUNE_BATCH_SIZE,
  pauseMs: number = PAUSE_MS
): Promise<number> {
  let total = 0;
  for (const months of RETENTION_MONTHS_OPTIONS) {
    const cutoff = retentionCutoff(months, now);
    const owners =
      months === DEFAULT_RETENTION_MONTHS
        ? Prisma.sql`e.user_id NOT IN (SELECT user_id FROM user_settings WHERE change_history_retention_months <> ${months})`
        : Prisma.sql`e.user_id IN (SELECT user_id FROM user_settings WHERE change_history_retention_months = ${months})`;
    for (;;) {
      const deleted = await prisma.$executeRaw`
        DELETE FROM change_ledger_entries
        WHERE id IN (
          SELECT e.id FROM change_ledger_entries e
          WHERE e.created_at < ${cutoff} AND ${owners}
          ORDER BY e.created_at
          LIMIT ${batchSize}
        )`;
      total += deleted;
      if (deleted < batchSize) break;
      await sleep(pauseMs);
    }
  }
  return total;
}

export async function retentionMonthsFor(userId: string): Promise<RetentionMonths> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { changeHistoryRetentionMonths: true },
  });
  const months = row?.changeHistoryRetentionMonths;
  return RETENTION_MONTHS_OPTIONS.find((m) => m === months) ?? DEFAULT_RETENTION_MONTHS;
}
