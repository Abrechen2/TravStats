import { expectingUniqueConflict, prisma } from "../../db";
import { Prisma } from "../../prisma";
import type { ReminderDomain } from "./prefs";

/**
 * Durable "this reminder was sent" claims (table `reminder_claims`).
 *
 * `claimReminder` is taken BEFORE a send and answers whether this caller owns
 * it. A restart or a second worker finds the row and stays quiet. Three cases
 * let a row be taken again: (1) a claim that never reached `sentAt` and is
 * older than the lease (the sender crashed), (2) a sent row whose entry moved
 * by more than {@link REARM_MS} (the user rescheduled it), (3) none other.
 */
export const LEASE_MS = 10 * 60 * 1000;
export const REARM_MS = 30 * 60 * 1000;

export interface ClaimKey {
  userId: string;
  domain: ReminderDomain;
  entryId: string;
  leadHours: number;
  /** "mail", or `push:<apiTokenId>` for one device. */
  channel: string;
}

/** `claimedAt` is the lease generation: only the holder of it may finish or free the claim. */
export type Claim = { id: string; claimedAt: Date } | null;

const where = (k: ClaimKey) => ({
  userId_domain_entryId_leadHours_channel: {
    userId: k.userId,
    domain: k.domain,
    entryId: k.entryId,
    leadHours: k.leadHours,
    channel: k.channel,
  },
});

export async function claimReminder(
  key: ClaimKey,
  anchorAt: Date,
  now: Date = new Date()
): Promise<Claim> {
  try {
    const created = await expectingUniqueConflict("ReminderClaim", () =>
      prisma.reminderClaim.create({ data: { ...key, anchorAt, claimedAt: now } })
    );
    return { id: created.id, claimedAt: created.claimedAt };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  const row = await prisma.reminderClaim.findUnique({ where: where(key) });
  if (!row) return null;
  const leaseOver = row.claimedAt.getTime() <= now.getTime() - LEASE_MS;
  const moved = Math.abs(row.anchorAt.getTime() - anchorAt.getTime()) > REARM_MS;
  const takeable = row.sentAt === null ? leaseOver || moved : moved;
  if (!takeable) return null;
  // Compare-and-set on the state we read, so two takers cannot both win.
  const won = await prisma.reminderClaim.updateMany({
    where: { id: row.id, claimedAt: row.claimedAt, anchorAt: row.anchorAt },
    data: { claimedAt: now, anchorAt, sentAt: null },
  });
  return won.count === 1 ? { id: row.id, claimedAt: now } : null;
}

export async function markSent(
  claim: { id: string; claimedAt: Date },
  now: Date = new Date()
): Promise<void> {
  // Fenced on the lease generation: a worker whose lease was taken over cannot mark the new one.
  await prisma.reminderClaim.updateMany({
    where: { id: claim.id, claimedAt: claim.claimedAt },
    data: { sentAt: now },
  });
}

/** The send failed: make the claim takeable at once so the next run retries (within the lateness bound). */
export async function releaseClaim(claim: { id: string; claimedAt: Date }): Promise<void> {
  await prisma.reminderClaim.updateMany({
    where: { id: claim.id, claimedAt: claim.claimedAt, sentAt: null },
    data: { claimedAt: new Date(0) },
  });
}
