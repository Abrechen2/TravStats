/**
 * Offering a trip from its page to someone on a connected server (simplified setup 2026-11-02,
 * forgejo#301): by a connection the caller already has, or by server and username of one — an
 * active connection is required (spec 2026-11-02; a name no longer pairs on the way). The trip is
 * checked first. The offer itself is
 * the F-S4c one: the person answers it in their inbox, and nothing is copied before.
 */
import { prisma } from "../../../db";
import { requireTripFederation } from "./access";
import { remoteShareError } from "./errors";
import { ownTripFor, requireHome } from "./offerBuild";
import { offerTrip } from "./offers";
import type { RemoteMemberView } from "./remoteMemberView";

export type OfferTarget = { remoteId: string } | { origin: string; username: string };

export async function offerTripTo(
  userId: string,
  tripId: string,
  target: OfferTarget
): Promise<RemoteMemberView> {
  if ("remoteId" in target) return offerTrip(userId, tripId, target.remoteId);
  await requireTripFederation(userId);
  const trip = await ownTripFor(prisma, userId, tripId);
  await requireHome(prisma, userId, trip.shareGroupId);
  // Offering needs a confirmed connection (spec 2026-11-02): a name no longer pairs on the way.
  const connection = await prisma.remoteShareAccount.findFirst({
    where: { userId, origin: target.origin, username: target.username, state: "active" },
    select: { id: true },
  });
  if (!connection)
    throw remoteShareError(
      "SHARE_REMOTE_CONNECTION_REQUIRED",
      409,
      "Connect with that person first",
      { userId, origin: target.origin },
      { origin: target.origin }
    );
  return offerTrip(userId, tripId, connection.id);
}
