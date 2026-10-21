import { prisma } from "../../../db";

/**
 * After a restore (spec 2026-10-20 §8): a restored clone must not resume talking to peers as
 * this server. Every open invitation is consumed — a code handed out before the dump would
 * otherwise redeem against a database that no longer matches what its issuer saw — and every
 * accepted consent with a person on another server goes back to a question, so its owner
 * confirms it again. Every membership of a person on another server is suspended (F-S4c):
 * nothing is offered, answered or delivered from a clone until its owner re-confirms. Every
 * queued message is deleted (F-S4d): it was written by the server the dump came from. Each
 * membership is resumed by its person, per trip (`lifecycle.ts` `reconfirmTrip`, F-S4e), which
 * accepts the consent again and, at the home, sends the trip's entries once more.
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
    // An offer still open is held apart, so confirming it again re-opens it instead of taking it.
    prisma.tripShareRemoteMember.updateMany({
      where: { state: "invited" },
      data: { state: "suspended", stateReason: "restore-invited", stateSince: now },
    }),
    prisma.tripShareRemoteMember.updateMany({
      where: {
        OR: [
          { state: { in: ["active", "unreachable"] } },
          { state: "suspended", stateReason: { in: ["off", "peer-blocked", "repinned"] } },
        ],
      },
      data: { state: "suspended", stateReason: "restore", stateSince: now },
    }),
    prisma.tripShareOutbox.deleteMany({}),
  ]);
}
