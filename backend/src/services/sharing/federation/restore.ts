import { prisma } from "../../../db";

/**
 * After a restore (spec 2026-10-20 §8): a restored clone must not resume talking to peers as
 * this server. Every open invitation is consumed — a code handed out before the dump would
 * otherwise redeem against a database that no longer matches what its issuer saw — and every
 * accepted consent with a person on another server goes back to a question, so its owner
 * confirms it again. Every membership of a person on another server is suspended (F-S4c):
 * nothing is offered, answered or delivered from a clone until its owner re-confirms. The outbox
 * joins this list with F-S4d.
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
    prisma.tripShareRemoteMember.updateMany({
      where: { state: { in: ["invited", "active", "unreachable"] } },
      data: { state: "suspended", stateReason: "restore", stateSince: now },
    }),
  ]);
}
