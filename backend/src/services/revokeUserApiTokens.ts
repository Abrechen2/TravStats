import { prisma, type DbTransaction } from "../db";
import type { Prisma } from "../prisma";
import { AppError } from "../middleware/errorHandler";

/**
 * Cut off every non-cookie way into an account: revoke all live API tokens
 * (PATs, device and pairing tokens), drop their push registrations and
 * delete unspent pairing codes (a code issued before the change could still
 * be exchanged for a fresh token afterwards). `sessionEpoch` closes the cookie
 * sessions only (forgejo#412 M1).
 */
async function revokeAll(tx: DbTransaction, userId: string): Promise<void> {
  await tx.apiToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await tx.devicePush.deleteMany({ where: { userId } });
  await tx.pairingCode.deleteMany({ where: { userId, consumedAt: null } });
}

/**
 * Write a new password (plus whatever else the caller clears), bump the
 * session epoch and revoke every token, as ONE step under the account's row
 * lock (forgejo#415).
 *
 * Before this, the revocation and the password write were two statements, and
 * a token issued at the same moment — a pairing claim that had already
 * consumed its code, a PAT whose request was authenticated a moment earlier —
 * could be inserted after the revocation and survive the change. Every issuing
 * path now takes the same row in share mode (`holdForIssuance`) and checks the
 * epoch it was authenticated under, so it lands either wholly before this
 * transaction (and is revoked by it) or wholly after it (and is refused).
 *
 * One transaction: a failure leaves the old password AND the old tokens.
 */
export async function rotateCredentials(
  userId: string,
  data: Omit<Prisma.UserUpdateInput, "sessionEpoch">
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    await revokeAll(tx, userId);
    return tx.user.update({
      where: { id: userId },
      data: { ...data, sessionEpoch: { increment: 1 } },
    });
  });
}

/**
 * The issuing side of `rotateCredentials`: take the account's row in share mode
 * (waits for a password change in flight, holds one off until the issue
 * commits) and refuse when the account is gone or its epoch moved past the one
 * the request was authenticated under. `expectedEpoch` undefined skips the
 * epoch check — for a path whose proof is not a session (a pairing code, which
 * the caller re-checks under this lock).
 */
export async function holdForIssuance(
  tx: DbTransaction,
  userId: string,
  expectedEpoch: number | undefined
): Promise<void> {
  const rows = await tx.$queryRaw<{ session_epoch: number }[]>`
    SELECT session_epoch FROM users WHERE id = ${userId} FOR SHARE`;
  const current = rows[0]?.session_epoch;
  if (current === undefined || (expectedEpoch !== undefined && current !== expectedEpoch)) {
    throw new AppError("Session expired - please sign in again", 401);
  }
}
