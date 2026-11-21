import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { securityLogger } from "../../utils/logger";
import { takeUserCountLock } from "../../utils/userCountLock";
import { deleteAccountWithFiles } from "../files/accountFiles";
import { notifyPeersOfDeparture } from "./notifyPeersOfDeparture";

export interface RemovalContext {
  /** Who asked: the account itself, or the administrator who deleted it. */
  actorId: string;
  ip?: string;
}

const lastAdminError = (): AppError =>
  new AppError("Cannot delete the last remaining admin", 409, "DELETE_LAST_ADMIN");

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
 * An unlocked look before the peers are told keeps the common refusal from
 * ending connections of an account that then stays.
 *
 * Every deletion is a `security_event` (`account_deleted`) — the audit trail.
 * It names ids, never the username: the account asked to be forgotten.
 */
export async function removeAccount(userId: string, context: RemovalContext): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  if (target?.isAdmin && (await prisma.user.count({ where: { isAdmin: true } })) <= 1) {
    throw lastAdminError();
  }

  const peers = await notifyPeersOfDeparture(userId);

  await deleteAccountWithFiles(userId, () =>
    prisma.$transaction(async (tx) => {
      await takeUserCountLock(tx);
      const locked = await tx.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
      if (locked?.isAdmin && (await tx.user.count({ where: { isAdmin: true } })) <= 1) {
        throw lastAdminError();
      }
      await tx.user.delete({ where: { id: userId } });
      await tx.syncChange.deleteMany({ where: { userId } });
    })
  );

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
