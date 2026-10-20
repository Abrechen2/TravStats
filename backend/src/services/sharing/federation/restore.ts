import { prisma } from "../../../db";

/**
 * After a restore (spec 2026-10-20 §8): a restored clone must not resume talking to peers as
 * this server. Every open invitation is consumed — a code handed out before the dump would
 * otherwise redeem against a database that no longer matches what its issuer saw — and every
 * accepted consent with a person on another server goes back to a question, so its owner
 * confirms it again. Phases F-S4c–e add the memberships and the outbox to this list.
 */
export async function suspendTripFederationAfterRestore(): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.tripShareInvite.updateMany({ where: { usedAt: null }, data: { usedAt: now } }),
    prisma.shareConsent.updateMany({
      where: {
        status: "accepted",
        OR: [{ remoteRequesterId: { not: null } }, { remoteTargetId: { not: null } }],
      },
      data: { status: "pending", decidedAt: null },
    }),
  ]);
}
