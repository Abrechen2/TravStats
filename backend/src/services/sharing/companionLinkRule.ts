import { prisma } from "../../db";
import { mayOfferTripTo } from "../friends/authz";

/**
 * May `userId` say that one of their companions IS `targetId`'s account?
 *
 * Where `userId` may offer trips to them (their consent or connection), as
 * before — and where the two already share a trip on this server. A local
 * share is consented one way: the sharer asked, the recipient accepted. The
 * recipient then sees the sharer on the trip next to their own typed
 * companion of the same name and was never asked "Ist das …?" (rc46 UAT),
 * because they had given no consent of their own toward the sharer. Sharing a
 * trip is the stronger tie; it lets the question and the link through.
 */
export async function mayLinkCompanionTo(userId: string, targetId: string): Promise<boolean> {
  if (await mayOfferTripTo(prisma, userId, targetId)) return true;
  return sharesATrip(userId, targetId);
}

/** Do both accounts hold a copy of one shared trip (the same share group)? */
export async function sharesATrip(userId: string, otherId: string): Promise<boolean> {
  const groups = await prisma.trip.findMany({
    where: { userId: otherId, shareGroupId: { not: null } },
    select: { shareGroupId: true },
  });
  const ids = groups.flatMap((g) => (g.shareGroupId ? [g.shareGroupId] : []));
  if (ids.length === 0) return false;
  const mine = await prisma.trip.findFirst({
    where: { userId, shareGroupId: { in: ids } },
    select: { id: true },
  });
  return mine !== null;
}
