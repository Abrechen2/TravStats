import type { DbTransaction } from "../../db";

/**
 * Taking one member's trip out of its share group. The trip and every entry
 * on it stay the member's own (decisions 4 and 5): only the keys and the
 * group link go, and the members left behind are told (`left`). A group
 * nobody is left in is deleted. Used by leaving, by deleting a shared trip,
 * and by a consent being withdrawn.
 */
export async function detachTrip(
  tx: DbTransaction,
  userId: string,
  trip: { id: string; name: string; shareGroupId: string | null }
): Promise<void> {
  const groupId = trip.shareGroupId;
  if (!groupId) return;
  const own = { tripId: trip.id, userId, shareKey: { not: null } };
  const clear = { shareKey: null };
  await tx.flight.updateMany({ where: own, data: clear });
  await tx.lodgingStay.updateMany({ where: own, data: clear });
  await tx.cruise.updateMany({ where: own, data: clear });
  await tx.railJourney.updateMany({ where: own, data: clear });
  await tx.rentalBooking.updateMany({ where: own, data: clear });
  await tx.tripStop.updateMany({
    where: { tripId: trip.id, shareKey: { not: null } },
    data: clear,
  });
  await tx.trip.update({ where: { id: trip.id }, data: { shareGroupId: null } });

  const others = await tx.trip.findMany({
    where: { shareGroupId: groupId },
    select: { id: true, userId: true },
  });
  if (others.length === 0) {
    // Nobody left to join: notices that named the group keep their text;
    // their group link goes null.
    await tx.tripShareGroup.delete({ where: { id: groupId } });
    return;
  }
  await tx.shareNotice.createMany({
    data: others.map((other) => ({
      userId: other.userId,
      groupId,
      actorId: userId,
      kind: "left",
      entityType: "trip",
      entityKey: other.id,
      after: { tripName: trip.name },
    })),
  });
}

/**
 * A consent between `requesterId` and `targetId` was withdrawn: the target
 * stops receiving the requester's trips. In every group both are members of,
 * the target's trip is detached — unless an accepted consent between the two
 * remains in the other direction, which still covers the pair.
 */
export async function detachAfterWithdrawal(
  tx: DbTransaction,
  requesterId: string,
  targetId: string
): Promise<number> {
  const stillAccepted = await tx.shareConsent.count({
    where: {
      status: "accepted",
      OR: [
        { requesterId, targetId },
        { requesterId: targetId, targetId: requesterId },
      ],
    },
  });
  if (stillAccepted > 0) return 0;
  const requesterGroups = await tx.trip.findMany({
    where: { userId: requesterId, shareGroupId: { not: null } },
    select: { shareGroupId: true },
  });
  const groupIds = requesterGroups.map((t) => t.shareGroupId as string);
  if (groupIds.length === 0) return 0;
  const targetTrips = await tx.trip.findMany({
    where: { userId: targetId, shareGroupId: { in: groupIds } },
    select: { id: true, name: true, shareGroupId: true },
  });
  for (const trip of targetTrips) await detachTrip(tx, targetId, trip);
  return targetTrips.length;
}
