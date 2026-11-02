/**
 * What ends together with a connection, beyond what `revokePairing` already ends (consents,
 * memberships, queued messages, statistics, leaderboard, pending trip offers).
 *
 * Plans over the connection (spec 2026-11-02 §4, phase S2) end their remote memberships here: the
 * hook exists now so the cascade has one named place, and S2 fills it in. Called inside the
 * transaction that revokes the connection, whoever ended it.
 */
import type { DbTransaction } from "../../../../db";

export async function endPlanMembershipsOfConnection(
  _tx: DbTransaction,
  _connection: { id: string; userId: string }
): Promise<void> {
  // S2: end `travel_plan_members` bound to this connection.
}
