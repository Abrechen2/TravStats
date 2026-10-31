import { prisma } from "../../db";

/**
 * Can the server push to the calling device right now? Returned with the
 * reminder settings so the Companion knows whether to schedule its own
 * reminders (it does only while `available` is false).
 *
 * - `no_relay`: the admin has not switched push on, no relay address is set, or the relay
 *   has paused this instance (daily limit).
 * - `no_device_token`: the caller has no registered push token (a paired
 *   device that never registered one, a revoked pairing, a browser session
 *   with no phone at all).
 * - `token_rejected`: the relay named every token of the caller dead.
 *
 * A PAT / device-token request is judged by ITS device only. A browser session
 * has no device of its own, so it is judged by the account's devices: available
 * when any one can be pushed to.
 */
export type PushUnavailableReason = "no_relay" | "no_device_token" | "token_rejected";
export interface PushStatus {
  available: boolean;
  reason: PushUnavailableReason | null;
}

export async function relayConfigured(): Promise<boolean> {
  const settings = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { pushEnabled: true, pushRelayUrl: true, pushPausedUntil: true },
  });
  // A relay pause (its daily limit, up to 24 h) means nothing is delivered either.
  const paused = !!settings?.pushPausedUntil && settings.pushPausedUntil > new Date();
  return settings?.pushEnabled === true && !!settings.pushRelayUrl && !paused;
}

export async function pushStatusFor(
  userId: string,
  /** The calling PAT's id, or undefined for a browser session. */
  apiTokenId: string | undefined,
  now: Date = new Date()
): Promise<PushStatus> {
  if (!(await relayConfigured())) return { available: false, reason: "no_relay" };
  const devices = await prisma.devicePush.findMany({
    where: {
      userId,
      ...(apiTokenId !== undefined && { apiTokenId }),
      user: { isActive: true },
      apiToken: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    },
    select: { tokenRejectedAt: true },
  });
  if (devices.length === 0) return { available: false, reason: "no_device_token" };
  if (devices.every((d) => d.tokenRejectedAt !== null))
    return { available: false, reason: "token_rejected" };
  return { available: true, reason: null };
}
