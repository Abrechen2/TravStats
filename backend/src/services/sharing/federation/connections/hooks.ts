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
import type { DbTransaction } from "../../../../db";

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
