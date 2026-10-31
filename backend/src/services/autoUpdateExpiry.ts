import { prisma } from "../db";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_EXPIRY_HOURS = 24;

/**
 * How long a pending flight update stays open for this user: the "Expiry
 * (hours)" setting under Automatic updates. It was saved and returned but the
 * service hard-coded 24 h (forgejo#389), so the field changed nothing.
 */
export async function pendingUpdateExpiryMs(userId: string): Promise<number> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { autoUpdateExpiryHours: true },
  });
  return (row?.autoUpdateExpiryHours ?? DEFAULT_EXPIRY_HOURS) * HOUR_MS;
}
