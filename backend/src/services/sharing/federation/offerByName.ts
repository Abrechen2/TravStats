/**
 * Offering a trip from its page to someone on a connected server (simplified setup 2026-11-02,
 * forgejo#301): by a pairing the caller already has, or by server and username — then the person
 * is looked up among that server's findable users and paired on the way. The trip is checked
 * first, so a lookup never runs for a trip that could not be offered anyway. The offer itself is
 * the F-S4c one: the person answers it in their inbox, and nothing is copied before.
 */
import { prisma } from "../../../db";
import { requireTripFederation } from "./access";
import { findRemotePerson } from "./directory";
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
  const person = await findRemotePerson(userId, target.origin, target.username);
  return offerTrip(userId, tripId, person.id);
}
