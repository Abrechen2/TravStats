/**
 * An account's share groups after the account is gone. A group a trip was offered in from another
 * server has no creator here (`offerInbox.ts`), and its only members were this account's trips and
 * its membership rows — both go with the account, so the group stayed behind as an empty shell, and
 * the inbound log kept the home's messages for it. Sharing UAT 2 found 58 such groups and 73 log
 * rows on the Beta after the test account was deleted.
 */
import type { DbTransaction } from "../../../db";

/** The groups this account takes part in: its trips' groups and its memberships from afar. */
export async function accountShareGroups(tx: DbTransaction, userId: string): Promise<string[]> {
  const [trips, memberships] = await Promise.all([
    tx.trip.findMany({
      where: { userId, shareGroupId: { not: null } },
      select: { shareGroupId: true },
    }),
    tx.tripShareRemoteMember.findMany({
      where: { remote: { userId } },
      select: { groupId: true },
    }),
  ]);
  return [
    ...new Set([
      ...trips.flatMap((t) => (t.shareGroupId ? [t.shareGroupId] : [])),
      ...memberships.map((m) => m.groupId),
    ]),
  ];
}

/** Of these groups, remove those nothing holds any more, with the inbound log rows naming them. */
export async function pruneEmptyGroups(tx: DbTransaction, groupIds: readonly string[]) {
  if (groupIds.length === 0) return 0;
  const empty = await tx.tripShareGroup.findMany({
    where: { id: { in: [...groupIds] }, trips: { none: {} }, remoteMembers: { none: {} } },
    select: { id: true, homeOrigin: true, federatedRef: true },
  });
  for (const g of empty) {
    if (g.homeOrigin && g.federatedRef)
      await tx.tripShareInbound.deleteMany({
        where: { peerOrigin: g.homeOrigin, groupRef: g.federatedRef },
      });
  }
  await tx.tripShareGroup.deleteMany({ where: { id: { in: empty.map((g) => g.id) } } });
  return empty.length;
}
