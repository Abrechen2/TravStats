import { prisma } from "../../db";

/**
 * Push registrations of paired phones (TravStats#156).
 *
 * Revoking a pairing token is soft (`revokedAt`), so the `device_push`
 * cascade only fires on a hard delete. Every revoke path calls
 * {@link forgetPushForTokens} in the same request, so a revoked phone is
 * never notified again.
 */
export async function forgetPushForTokens(tokenIds: readonly string[]): Promise<number> {
  if (tokenIds.length === 0) return 0;
  const { count } = await prisma.devicePush.deleteMany({
    where: { apiTokenId: { in: [...tokenIds] } },
  });
  return count;
}

/** Whether this server's admin has switched push on — the phone shows why nothing arrives otherwise. */
export async function serverPushEnabled(): Promise<boolean> {
  const settings = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { pushEnabled: true },
  });
  return settings?.pushEnabled === true;
}
