import { prisma } from "../db";

/**
 * Cut off every non-cookie way into an account: revoke all live API tokens
 * (PATs, device and pairing tokens), drop their push registrations and
 * delete unspent pairing codes (a code issued before the change could still
 * be exchanged for a fresh token afterwards). Called whenever a password
 * changes: `sessionEpoch` closes the cookie sessions only (forgejo#412 M1).
 *
 * Callers run this BEFORE writing the new password, so a failure here leaves
 * the old credentials and an unconsumed reset link, not a changed password
 * with live tokens. One transaction, set-based statements, no id snapshot.
 */
export async function revokeAllApiTokensForUser(userId: string): Promise<number> {
  const [revoked] = await prisma.$transaction([
    prisma.apiToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.devicePush.deleteMany({ where: { userId } }),
    prisma.pairingCode.deleteMany({ where: { userId, consumedAt: null } }),
  ]);
  return revoked.count;
}
