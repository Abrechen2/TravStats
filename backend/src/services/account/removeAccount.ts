import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { securityLogger } from "../../utils/logger";
import { takeUserCountLock } from "../../utils/userCountLock";
import { deleteAccountWithFiles } from "../files/accountFiles";
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
 * The check reserves the deletion (role and sign-in off) before the peers are
 * told, and a failure afterwards gives both back.
 *
 * Every deletion is a `security_event` (`account_deleted`) — the audit trail.
 * It names ids, never the username: the account asked to be forgotten.
 */
export async function removeAccount(userId: string, context: RemovalContext): Promise<void> {
  // Reserve the deletion under the lock before any peer is told: the account
  // stops being an admin and stops signing in. A second admin deleting itself
  // at the same moment then counts one admin and is refused BEFORE its own
  // connections are withdrawn — a refusal must leave nothing ended.
  const before = await prisma.$transaction(async (tx) => {
    await takeUserCountLock(tx);
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true, isActive: true },
    });
    if (!target) throw new AppError("User not found", 404);
    if (target.isAdmin && (await tx.user.count({ where: { isAdmin: true } })) <= 1) {
      throw new AppError("Cannot delete the last remaining admin", 409, "DELETE_LAST_ADMIN");
    }
    await tx.user.update({ where: { id: userId }, data: { isAdmin: false, isActive: false } });
    return target;
  });

  let peers: DepartureNotice;
  try {
    peers = await notifyPeersOfDeparture(userId);
    await deleteAccountWithFiles(userId, () =>
      prisma.$transaction(async (tx) => {
        await tx.user.delete({ where: { id: userId } });
        await tx.syncChange.deleteMany({ where: { userId } });
      })
    );
  } catch (error) {
    // The rows are still here: give the account its role and sign-in back.
    await prisma.user
      .update({
        where: { id: userId },
        data: { isAdmin: before.isAdmin, isActive: before.isActive },
      })
      .catch((restoreError: unknown) =>
        securityLogger.error({
          operation: "security_event",
          message: "Account deletion failed and the account could not be restored",
          context: { eventType: "account_delete_restore_failed", userId, err: restoreError },
        })
      );
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
