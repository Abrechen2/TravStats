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
    // What a pairing showed (statistics level, leaderboard totals) is held with it: the clone
    // shows nothing until each consent is confirmed again and the level set anew.
    prisma.remoteShareAccount.updateMany({ data: { statsLevel: "off" } }),
    // A connection must be confirmed again by both sides (spec 2026-11-02 §9): the trips already
    // shared are held by the memberships above, nothing new starts before.
    prisma.remoteShareAccount.updateMany({
      where: { state: { in: ["active", "pending_in", "pending_out"] } },
      // The generation jumps past anything the other side may have seen since the dump, so the
      // request that confirms the connection again is not read as an old one.
      data: { state: "reconfirm", shareLeaderboard: false, generation: { increment: 1000 } },
    }),
    prisma.leaderboardConsent.updateMany({
      where: { status: "accepted", remote: { sharePairing: { isNot: null } } },
      data: { status: "withdrawn", decidedAt: now },
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
    // Plans over a connection end with the restore (spec 2026-11-02 §9): the connections are held
    // for confirmation, and an invitation or membership made by the dump's server is not this one's.
    prisma.travelPlanMember.updateMany({
      where: { kind: "remote", status: { in: ["invited", "active"] } },
      data: { status: "revoked", revokedAt: now },
    }),
    prisma.remotePlanMembership.updateMany({
      where: { state: { in: ["invited", "active"] } },
      data: { state: "ended", endedAt: now },
    }),
    prisma.connectionAnnouncement.deleteMany({}),
  ]);
}
