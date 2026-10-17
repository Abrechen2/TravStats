import { suspendComparisonAfterRestore } from "../federation/restore";
import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import logger from "../../utils/logger";
import { reconcileInterruptedBackups } from "./reconcileBackups";
import { resetSyncHistory } from "../sync/state";
import { deleteAllShareLinks } from "../shareLinks/deleteAll";
import { deleteAllCalendarFeeds } from "../calendarFeed/deleteAll";

/**
 * The columns of `admin_settings` that describe THIS MACHINE rather than the
 * data in it.
 *
 * A dump carries them like everything else, so a restore silently adopts the
 * identity of whichever instance produced it. That is not hypothetical: on
 * 2026-09-05 prod was rebuilt from an RC dump and inherited the RC's three
 * URLs, so every pairing QR prod printed for the next three days sent the
 * phone to a different server, where the code was unknown. It took until
 * 2026-09-08 to find, because nothing about the running instance looked wrong
 * (forgejo#115).
 *
 * The two WebAuthn columns are here for the same reason and are the more
 * dangerous half: a relying-party id is bound to a host, and a credential is
 * bound to ONE rpId forever. Adopting a foreign one does not degrade passkey
 * sign-in, it ends it.
 *
 * The push registration is the relay's name for this server: adopting another
 * server's id and secret sends this server's notifications under the other's
 * registration, and stops them the day that server rotates its secret.
 *
 * `null` is a real value here — it means "no override, fall back to ENV" — so
 * the raw row is read rather than the resolved settings, and a restore puts an
 * instance back on its own ENV rather than persisting it into the database.
 */
const INSTANCE_IDENTITY_SELECT = {
  frontendUrl: true,
  publicUrl: true,
  lanUrl: true,
  webauthnRpId: true,
  webauthnOrigins: true,
  pushInstanceId: true,
  pushInstanceSecret: true,
  pushRelayUrl: true,
  federationEnabled: true,
  federationOrigin: true,
  federationPrivateKey: true,
} as const satisfies Prisma.AdminSettingsSelect;

type InstanceIdentity = Prisma.AdminSettingsGetPayload<{
  select: typeof INSTANCE_IDENTITY_SELECT;
}>;
type IdentityColumn = keyof InstanceIdentity;

const INSTANCE_IDENTITY_COLUMNS = Object.keys(INSTANCE_IDENTITY_SELECT) as IdentityColumn[];

/** Encrypted at rest, but ciphertext still has no business in a log line. */
const SECRET_IDENTITY_COLUMNS: ReadonlySet<IdentityColumn> = new Set([
  "pushInstanceSecret",
  "federationPrivateKey",
]);

export async function readInstanceIdentity(): Promise<InstanceIdentity | null> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: INSTANCE_IDENTITY_SELECT,
  });
  return row ?? null;
}

function forLog(identity: Partial<InstanceIdentity>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(identity).map(([column, value]) => [
      column,
      SECRET_IDENTITY_COLUMNS.has(column as IdentityColumn) && value !== null
        ? "[redacted]"
        : value,
    ])
  );
}

/**
 * Put this instance's own identity back over whatever the dump brought.
 *
 * Deliberately loud: an administrator who restored a dump in order to ADOPT
 * its identity needs to see that it was overwritten, and the log names both
 * sides so the difference is readable without a database client.
 */
export async function restoreInstanceIdentity(before: InstanceIdentity | null): Promise<void> {
  if (!before) return;

  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { id: true, ...INSTANCE_IDENTITY_SELECT },
  });
  if (!row) return;

  const changed = INSTANCE_IDENTITY_COLUMNS.filter((column) => {
    const mine = before[column];
    const theirs = row[column];
    return Array.isArray(mine) || Array.isArray(theirs)
      ? JSON.stringify(mine ?? []) !== JSON.stringify(theirs ?? [])
      : mine !== theirs;
  });

  if (changed.length === 0) return;

  await prisma.adminSettings.update({ where: { id: row.id }, data: before });

  logger.warn({
    operation: "restore_instance_identity_kept",
    message:
      "The archive carried another instance's identity; this instance kept its own. Set these under Settings -> Instance if the archive's values were the intended ones.",
    fields: changed,
    kept: forLog(before),
    discarded: forLog(Object.fromEntries(changed.map((column) => [column, row[column]]))),
  });
}

type BackupRow = NonNullable<Awaited<ReturnType<typeof prisma.backup.findUnique>>>;

/**
 * The archive just restored stays restorable (forgejo#157 follow-up).
 *
 * A dump carries the `backups` table as it stood while that very dump was
 * being written, with its own row still `running`. The reconcile then marks it
 * failed ("Interrupted: restore of ..."), so the archive the admin had just
 * used successfully was refused the next time with "Backup is not completed"
 * (measured 2026-10-02, on the same version as well as across versions). This
 * instance read the row before the restore and knows the archive is complete,
 * having just restored from it, so that row is put back. Exported for its test.
 */
export async function keepRestoredBackupUsable(before: BackupRow): Promise<void> {
  // `createdAt` is carried: retention ages a row by it, and a recreated row
  // stamped "now" would outlive its archive by the whole retention window.
  const { id, metadata, updatedAt: _updatedAt, ...fields } = before;
  const data = {
    ...fields,
    metadata: metadata === null ? Prisma.JsonNull : (metadata as Prisma.InputJsonValue),
  };
  await prisma.backup.upsert({ where: { id }, update: data, create: { id, ...data } });
}

/**
 * Every row of the `backups` table, read BEFORE psql replaces it. The table
 * describes archives on this machine's disk and this instance's share, not
 * user data, so the archive's copy of it is the one thing a restore must not
 * believe. Bounded by retention; ordered so the read is total.
 */
async function readBackupRows(): Promise<BackupRow[]> {
  return prisma.backup.findMany({ orderBy: { id: "asc" } });
}

/**
 * Put back every backup row this instance had before psql replaced the table.
 *
 * Only the restored archive's own row used to be put back, so every row newer
 * than the archive vanished — the safety backup taken a moment earlier among
 * them. Its directory stayed on disk, unlisted, and retention never reached
 * it. Rows present on both sides are overwritten too: the archive's copy is
 * older than what this machine knows about its own files and uploads.
 *
 * Rows only the archive carried keep their listing but lose their recorded
 * remote target. They are either archives this instance has since deleted or
 * another instance's; retention deletes a remote copy only where a target is
 * recorded, so it can no longer reach into another instance's WebDAV share
 * through settings and rows a cross-instance restore brought along.
 */
async function keepThisInstancesBackupRows(before: BackupRow[]): Promise<void> {
  for (const row of before) await keepRestoredBackupUsable(row);
  const disowned = await prisma.backup.updateMany({
    where: { id: { notIn: before.map((row) => row.id) }, cloudTarget: { not: null } },
    data: { cloudTarget: null },
  });
  if (disowned.count > 0) {
    logger.warn({
      operation: "restore_backup_rows_disowned",
      message:
        "Backup rows from the archive keep their listing but no remote target; retention will not delete their remote copies",
      count: disowned.count,
    });
  }
}

/**
 * Each thing a committed restore owes this machine, in order.
 *
 * - its own identity (forgejo#115);
 * - the sync feed's history: the phones' cursors describe the database that
 *   was just replaced, and continuing them would patch the archive with
 *   changes it never had (forgejo#141) — a new epoch sends every client to a
 *   full read;
 * - no public links: a dump taken before a revoke would bring the revoked
 *   link back to life (forgejo#281, T14), and no calendar feed URLs, for the
 *   same reason (forgejo#310);
 * - no backup row left `running`: the archive carries the row of the very
 *   backup being dumped, still `running`, and left alone it is a permanent
 *   lock — further backups and restores answer 409 and the scheduler skips.
 *   The route verified nothing was running before the restore began, so
 *   anything in flight now came out of the archive (AUD-069);
 * - this machine's backup rows (see `keepThisInstancesBackupRows`).
 */
function settlingSteps(
  identityBefore: InstanceIdentity | null,
  backupsBefore: BackupRow[] | null,
  backupId: string
): Array<[string, () => Promise<unknown>]> {
  const reason = `restore of backup ${backupId}`;
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["suspend_comparison", () => suspendComparisonAfterRestore()],
    ["instance_identity", () => restoreInstanceIdentity(identityBefore)],
    ["sync_history", () => resetSyncHistory(reason)],
    ["share_links", () => deleteAllShareLinks(reason)],
    ["calendar_feeds", () => deleteAllCalendarFeeds(reason)],
  ];
  if (!backupsBefore) return steps;
  return [
    ...steps,
    ["interrupted_backups", () => reconcileInterruptedBackups(reason)],
    ["backup_rows", () => keepThisInstancesBackupRows(backupsBefore)],
  ];
}

/**
 * Run every step even when one fails, and answer with the first failure.
 *
 * They used to run as one chain, so a single failing step skipped the rest:
 * a locked comparison table left the instance on the archive's identity.
 */
async function settle(steps: Array<[string, () => Promise<unknown>]>, backupId: string) {
  let firstFailure: { error: unknown } | null = null;
  for (const [step, run] of steps) {
    try {
      await run();
    } catch (error) {
      logger.error({
        operation: "restore_settle_step_failed",
        message: "A step after the database restore failed; the remaining steps still ran",
        step,
        backupId,
        err: error,
      });
      firstFailure ??= { error };
    }
  }
  return firstFailure;
}

/**
 * What the instance must put right once psql has replaced the database —
 * every step but the backup rows, which need a read from before psql.
 * Exported for its tests.
 */
export async function afterDatabaseRestore(
  identityBefore: InstanceIdentity | null,
  backupId: string
): Promise<void> {
  const failure = await settle(settlingSteps(identityBefore, null, backupId), backupId);
  if (failure) throw failure.error;
}

/**
 * Replace the database, check it, and put back what describes this machine.
 *
 * `replaceDatabase` is the psql run; `verify` asks the committed result
 * whether it matches this version. Once `replaceDatabase` has returned, psql
 * has committed, so the settling runs whatever `verify` says: a schema check
 * that threw used to skip it, and left the archive's identity, the phones'
 * stale cursors, revived share links and a `running` lock behind a restore
 * that had in fact replaced the database. `verify`'s failure is still the
 * answer. Exported so the ordering can be tested without a psql binary.
 */
export async function restoreDatabaseThenSettle(
  backup: BackupRow,
  replaceDatabase: () => Promise<void>,
  verify: () => Promise<void>
): Promise<void> {
  const identityBefore = await readInstanceIdentity();
  const backupsBefore = await readBackupRows();
  // The archive's row as this restore found it, should a concurrent delete
  // have removed it between the route's check and this read.
  const rows = backupsBefore.some((row) => row.id === backup.id)
    ? backupsBefore
    : [...backupsBefore, backup];

  await replaceDatabase();

  let verifyFailure: { error: unknown } | null = null;
  try {
    await verify();
  } catch (error) {
    verifyFailure = { error };
  }
  const settleFailure = await settle(settlingSteps(identityBefore, rows, backup.id), backup.id);

  const failure = verifyFailure ?? settleFailure;
  if (failure) throw failure.error;
}
