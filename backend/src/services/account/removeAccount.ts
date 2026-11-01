import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { takeUserCountLock } from "../../utils/userCountLock";
import { deleteAccountWithFiles } from "../files/accountFiles";

/**
 * The one way an account goes away (admin delete and self-delete share it).
 *
 * Rows by cascade, then the account's uploaded files — every upload directory,
 * through the one step every account deletion uses (forgejo#287). The sync
 * change log has no foreign key (its own cascade writes tombstones into it), so
 * it goes in the same transaction: a deleted account's log must not outlive it
 * until the nightly prune (beta.23 UAT).
 *
 * The last admin is protected HERE, under the user-count lock, not only in the
 * routes: two admins deleting each other (or themselves) at the same moment
 * both read "two admins" and would leave an instance nobody can administer.
 */
export async function removeAccount(userId: string): Promise<void> {
  await deleteAccountWithFiles(userId, () =>
    prisma.$transaction(async (tx) => {
      await takeUserCountLock(tx);
      const target = await tx.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
      if (target?.isAdmin && (await tx.user.count({ where: { isAdmin: true } })) <= 1) {
        throw new AppError("Cannot delete the last remaining admin", 409, "DELETE_LAST_ADMIN");
      }
      await tx.user.delete({ where: { id: userId } });
      await tx.syncChange.deleteMany({ where: { userId } });
    })
  );
}
