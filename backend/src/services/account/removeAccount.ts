import { prisma } from "../../db";
import { deleteAccountWithFiles } from "../files/accountFiles";

/**
 * The one way an account goes away (admin delete and self-delete share it).
 *
 * Rows by cascade, then the account's uploaded files — every upload directory,
 * through the one step every account deletion uses (forgejo#287). The sync
 * change log has no foreign key (its own cascade writes tombstones into it), so
 * it goes in the same transaction: a deleted account's log must not outlive it
 * until the nightly prune (beta.23 UAT).
 */
export async function removeAccount(userId: string): Promise<void> {
  await deleteAccountWithFiles(userId, () =>
    prisma.$transaction([
      prisma.user.delete({ where: { id: userId } }),
      prisma.syncChange.deleteMany({ where: { userId } }),
    ])
  );
}
