import { prisma } from "../../db";
import logger from "../../utils/logger";

/**
 * How long a tombstone is kept: 90 days.
 *
 * A phone syncs whenever it is opened; the case this has to cover is the
 * longest stretch a person plausibly travels without once opening the app on
 * a connection — a long trip or a season abroad. A phone that stayed away
 * longer is told to resync in full (`SYNC_RESYNC_REQUIRED`), which costs one
 * larger download and loses nothing, whereas a horizon that is too short
 * costs that download needlessly. Change rows are small, so the bound is the
 * phone's absence, not the table's size.
 */
export const SYNC_RETENTION_DAYS = 90;

export interface SyncStateRow {
  epoch: string;
  prunedXid: bigint;
  prunedSeq: bigint;
  historyFrom: Date;
}

/** The single bookkeeping row the migration inserted. Its absence is a fault. */
export async function loadSyncState(): Promise<SyncStateRow> {
  const state = await prisma.syncState.findUnique({ where: { id: 1 } });
  if (!state) {
    throw new Error("sync_state row is missing — the sync feed cannot vouch for any cursor");
  }
  return state;
}

export interface PruneResult {
  pruned: number;
  orphaned: number;
}

/**
 * Delete change rows older than the horizon and raise the watermark to the
 * highest (xid, seq) deleted, so a cursor below it is refused instead of
 * answered with a feed that lacks those rows.
 *
 * Rows of deleted accounts go too; they belong to nobody, so they do not
 * move the watermark.
 */
export async function pruneSyncChanges(
  retentionDays: number = SYNC_RETENTION_DAYS
): Promise<PruneResult> {
  // The cutoff is computed in SQL with LOCALTIMESTAMP, the same clock and the
  // same session zone that stamped `created_at` (its column default), so the
  // two can never disagree about how old a row is.
  return prisma.$transaction(async (tx) => {
    const orphaned = await tx.$executeRaw`
      DELETE FROM sync_changes c
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id)`;
    const rows = await tx.$queryRaw<
      Array<{ n: bigint; xid: bigint | null; seq: bigint | null; newest: Date | null }>
    >`
      WITH gone AS (
        DELETE FROM sync_changes
        WHERE created_at < LOCALTIMESTAMP - make_interval(days => ${retentionDays}::int)
        RETURNING xid, seq, row_updated_at
      ),
      top AS (SELECT xid, seq FROM gone ORDER BY xid DESC, seq DESC LIMIT 1)
      SELECT (SELECT count(*) FROM gone) AS n,
             (SELECT xid FROM top) AS xid,
             (SELECT seq FROM top) AS seq,
             (SELECT max(row_updated_at) FROM gone) AS newest`;
    const summary = rows[0];
    const pruned = Number(summary?.n ?? 0);
    if (pruned > 0 && summary.xid !== null && summary.seq !== null) {
      await tx.$executeRaw`
        UPDATE sync_state SET
          pruned_xid = CASE WHEN (${summary.xid}::bigint, ${summary.seq}::bigint) > (pruned_xid, pruned_seq)
                            THEN ${summary.xid}::bigint ELSE pruned_xid END,
          pruned_seq = CASE WHEN (${summary.xid}::bigint, ${summary.seq}::bigint) > (pruned_xid, pruned_seq)
                            THEN ${summary.seq}::bigint ELSE pruned_seq END,
          history_from = GREATEST(history_from, COALESCE(${summary.newest}::timestamp(3), history_from)),
          updated_at = (now() AT TIME ZONE 'UTC')
        WHERE id = 1`;
    }
    return { pruned, orphaned };
  });
}

/**
 * Start a new feed history: after a database restore the rows are the
 * archive's, not the ones the phones were told about, and the transaction
 * counter may not even be the same one. Every cursor minted before this is
 * refused (new epoch), and the old change rows go with it.
 */
export async function resetSyncHistory(reason: string): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM sync_changes`,
    prisma.$executeRaw`
      INSERT INTO sync_state (id, epoch, pruned_xid, pruned_seq, history_from, updated_at)
      VALUES (1, gen_random_uuid()::text, 0, 0, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      ON CONFLICT (id) DO UPDATE SET
        epoch = EXCLUDED.epoch,
        pruned_xid = 0,
        pruned_seq = 0,
        history_from = EXCLUDED.history_from,
        updated_at = EXCLUDED.updated_at`,
  ]);
  logger.info({ operation: "sync_history_reset", message: "Sync feed history restarted", reason });
}
