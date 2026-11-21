import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { securityLogger } from "../../utils/logger";
import { takeUserCountLock } from "../../utils/userCountLock";
import { deleteAccountWithFiles } from "../files/accountFiles";
import { cancelAccountExports, deleteAccountArchives } from "../accountArchive/archiveJobs";
import { notifyPeersOfDeparture, type DepartureNotice } from "./notifyPeersOfDeparture";

export interface RemovalContext {
  /** Who asked: the account itself, or the administrator who deleted it. */
  actorId: string;
  ip?: string;
}

/**
 * The one way an account goes away (admin delete and self-delete share it).
 *
 * Federated peers first (`notifyPeersOfDeparture`), through the same
 * withdrawal path a user ending a connection takes, while the rows that
 * address them still exist. Then rows by cascade, then the account's uploaded
 * files — every upload directory, through the one step every account deletion
 * uses (forgejo#287). The sync change log has no foreign key (its own cascade
 * writes tombstones into it), so it goes in the same transaction: a deleted
 * account's log must not outlive it until the nightly prune (beta.23 UAT).
 *
 * The last admin is protected HERE, under the user-count lock, not only in the
 * routes: two admins deleting each other (or themselves) at the same moment
 * both read "two admins" and would leave an instance nobody can administer.
 * The check reserves the deletion (role and sign-in off, a marker with the
 * prior values) before the peers are told; a failure afterwards gives both
 * back, and a crash in between is settled by `recoverStalledDeletions`.
 *
 * Every deletion is a `security_event` (`account_deleted`) — the audit trail.
 * It names ids, never the username: the account asked to be forgotten.
 */
export async function removeAccount(userId: string, context: RemovalContext): Promise<void> {
  // Reserve the deletion under the lock before any peer is told: the account
  // stops being an admin and stops signing in, and the marker records what it
  // was. A second admin deleting itself at the same moment then counts one
  // admin and is refused BEFORE its own connections are withdrawn; a second
  // deletion of the same account finds the marker and is refused outright.
  await prisma.$transaction(async (tx) => {
    await takeUserCountLock(tx);
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true, isActive: true, deletionStartedAt: true },
    });
    if (!target) throw new AppError("User not found", 404);
    if (target.deletionStartedAt) {
      throw new AppError("This account is already being deleted", 409, "DELETE_IN_PROGRESS");
    }
    if (target.isAdmin && (await tx.user.count({ where: { isAdmin: true } })) <= 1) {
      throw new AppError("Cannot delete the last remaining admin", 409, "DELETE_LAST_ADMIN");
    }
    await tx.user.update({
      where: { id: userId },
      data: {
        isAdmin: false,
        isActive: false,
        deletionStartedAt: new Date(),
        deletionPriorAdmin: target.isAdmin,
        deletionPriorActive: target.isActive,
      },
    });
  });

  // A running export of this account must not register its ZIP once the rows go.
  cancelAccountExports(userId);
  let peers: DepartureNotice;
  try {
    peers = await finishDeletion(userId);
  } catch (error) {
    // The rows are still here: give the account its role and sign-in back.
    await restoreReserved(userId, "delete_failed");
    throw error;
  }

  securityLogger.info({
    operation: "security_event",
    message: "Account deleted",
    context: {
      eventType: "account_deleted",
      userId,
      actorId: context.actorId,
      self: context.actorId === userId,
      peersWithdrawn: peers.ended,
      peersFailed: peers.failed,
      ip: context.ip ?? null,
    },
  });
}

/**
 * Peers, then rows and files. Idempotent: an ended connection is not open, a
 * gone file is "missing". The delete is conditional on the reservation, so a
 * row a recovery restored meanwhile is never deleted.
 */
async function finishDeletion(userId: string): Promise<DepartureNotice> {
  const peers = await notifyPeersOfDeparture(userId);
  await deleteAccountWithFiles(userId, () =>
    prisma.$transaction(async (tx) => {
      const gone = await tx.user.deleteMany({
        where: { id: userId, deletionStartedAt: { not: null } },
      });
      if (gone.count !== 1) throw new AppError("The deletion is no longer reserved", 409);
      await tx.syncChange.deleteMany({ where: { userId } });
    })
  );
  // Finished account ZIPs (forgejo#433) are copies of every file just removed.
  await deleteAccountArchives(userId);
  return peers;
}

/**
 * Undo a reservation: the prior role and sign-in back, the marker cleared. Only
 * a reserved row is touched (`deletionStartedAt` set), and a restore that
 * itself fails is logged as an error — never a silent demoted account.
 */
async function restoreReserved(userId: string, reason: string): Promise<void> {
  try {
    const row = await prisma.user.findFirst({
      where: { id: userId, deletionStartedAt: { not: null } },
      select: { deletionPriorAdmin: true, deletionPriorActive: true },
    });
    if (!row) return;
    await prisma.user.updateMany({
      where: { id: userId, deletionStartedAt: { not: null } },
      data: {
        isAdmin: row.deletionPriorAdmin ?? false,
        isActive: row.deletionPriorActive ?? true,
        deletionStartedAt: null,
        deletionPriorAdmin: null,
        deletionPriorActive: null,
      },
    });
    securityLogger.warn({
      operation: "security_event",
      message: "Account deletion did not complete; the account was restored",
      context: { eventType: "account_delete_restored", userId, reason },
    });
  } catch (restoreError) {
    securityLogger.error({
      operation: "security_event",
      message: "Account deletion failed and the account could not be restored",
      context: { eventType: "account_delete_restore_failed", userId, err: restoreError },
    });
  }
}

/** A reservation older than this is a deletion a crash or a kill interrupted. */
export const STALLED_DELETION_MS = 10 * 60_000;

export interface StalledDeletionRun {
  completed: number;
  restored: number;
}

/**
 * Settle every deletion a crash left half-done (run at boot and every ten
 * minutes by `accountDeletionRecoveryScheduler`).
 *
 * Completed, not restored, by default: the user (or an admin) asked for the
 * deletion and re-authenticated for it, and the peers may already have been
 * told the account is gone. Restoring would bring back an account its owner
 * asked to erase, with its connections already ended. Finishing re-runs the
 * same idempotent step. Restored instead when finishing would leave the
 * instance without any admin (the other admin went in the meantime), or when
 * finishing fails — then the account is back, signed-in-able, and logged.
 */
export async function recoverStalledDeletions(now = new Date()): Promise<StalledDeletionRun> {
  const run: StalledDeletionRun = { completed: 0, restored: 0 };
  const stalled = await prisma.user.findMany({
    where: { deletionStartedAt: { lt: new Date(now.getTime() - STALLED_DELETION_MS) } },
    select: { id: true, deletionPriorAdmin: true, deletionStartedAt: true },
  });
  for (const u of stalled) {
    // Claim it: the marker moves to now only for the one sweep that read it as
    // it is. Another sweep (a second process) skips it, and a live deletion
    // sees a fresh marker rather than a stalled one.
    const claimed = await prisma.user.updateMany({
      where: { id: u.id, deletionStartedAt: u.deletionStartedAt },
      data: { deletionStartedAt: now },
    });
    if (claimed.count !== 1) continue;
    if (u.deletionPriorAdmin && (await prisma.user.count({ where: { isAdmin: true } })) === 0) {
      await restoreReserved(u.id, "would_leave_no_admin");
      run.restored++;
      continue;
    }
    try {
      const peers = await finishDeletion(u.id);
      run.completed++;
      securityLogger.info({
        operation: "security_event",
        message: "Interrupted account deletion completed",
        context: {
          eventType: "account_deleted",
          userId: u.id,
          recovered: true,
          peersWithdrawn: peers.ended,
          peersFailed: peers.failed,
        },
      });
    } catch {
      await restoreReserved(u.id, "recovery_failed");
      run.restored++;
    }
  }
  return run;
}
