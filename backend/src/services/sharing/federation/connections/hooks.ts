/**
 * What ends together with a connection, beyond what `revokePairing` already ends (consents,
 * memberships, queued messages, statistics, leaderboard, pending trip offers): the plans that ran
 * over it (spec 2026-11-02 §4, §9). Called inside the transaction that revokes the connection,
 * whoever ended it, on BOTH servers - each end its own side:
 *
 * - the host side: the person's `travel_plan_members` bound to the connection are revoked, so the
 *   next call of that person is refused (the per-call check would refuse it anyway; the rows say
 *   so in the owner's member list);
 * - the member side: the invitations and plans of that person's server are ended, so they leave
 *   the plan list and the inbox.
 *
 * The plan's own data and its linked trip copies are untouched; only access ends.
 */
import { prisma, type DbTransaction } from "../../../../db";

export async function endPlanMembershipsOfConnection(
  tx: DbTransaction,
  connection: { id: string; userId: string }
): Promise<void> {
  const now = new Date();
  await tx.travelPlanMember.updateMany({
    where: {
      kind: "remote",
      connectionId: connection.id,
      status: { in: ["invited", "active"] },
    },
    data: { status: "revoked", revokedAt: now },
  });
  await tx.remotePlanMembership.updateMany({
    where: { connectionId: connection.id, state: { in: ["invited", "active"] } },
    data: { state: "ended", endedAt: now },
  });
}

/**
 * A server's key was replaced (admin re-pin): a new key is a new party until someone says
 * otherwise. Every connection with that origin goes back to `reconfirm` - no plan, statistics or
 * offer flows over it until both people confirm again - and the plan memberships that rode on it
 * end on both sides. A server the admin only BLOCKS needs nothing here: the pin check on every
 * call (host guard and member exchange) already refuses it.
 */
export async function holdConnectionsOfOrigin(origin: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.travelPlanMember.updateMany({
      where: {
        kind: "remote",
        connection: { origin },
        status: { in: ["invited", "active"] },
      },
      data: { status: "revoked", revokedAt: now },
    }),
    prisma.remotePlanMembership.updateMany({
      where: { connection: { origin }, state: { in: ["invited", "active"] } },
      data: { state: "ended", endedAt: now },
    }),
    prisma.remoteShareAccount.updateMany({
      where: { origin, state: { in: ["active", "pending_in", "pending_out"] } },
      // The generation jumps so the request that confirms again is not read as an old one.
      data: {
        state: "reconfirm",
        statsLevel: "off",
        shareLeaderboard: false,
        generation: { increment: 1000 },
      },
    }),
  ]);
}
