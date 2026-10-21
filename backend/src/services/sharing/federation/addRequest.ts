/**
 * A member on a spoke asks the home to offer the trip to someone else (spec 2026-10-20 F5,
 * `add-request`, phase F-S4e). Offers stay with the home: the request becomes a notice for the
 * home member of that pairing, who decides — offering the trip to a person they are paired with,
 * or making a code for this trip (`/sharing/remote/trips/:tripId/invites`) and passing it on.
 * Nothing is offered by the request itself, and the spoke learns nothing of the home's pairings.
 */
import { prisma } from "../../../db";
import { acceptedParties } from "../members";
import type { AddRequestMessage, TripShareAck } from "../../../schemas/tripSharePeer";
import { requireTripFederation } from "./access";
import { remoteShareError } from "./errors";
import { refusedThere } from "./offers";
import { ownTripFor } from "./offerBuild";
import { requireAdmitted } from "./peerCheck";
import { addressed, requireReceiving } from "./peerMember";
import { rejectWith, sendOnStream, serveOnce, takeSeq } from "./streams";
import { TRIP_SHARE_TRANSPORT, messageHeader } from "./transport";

export interface AddRequestBody {
  displayName: string;
  origin?: string;
  note?: string;
}

/** The caller (on a spoke) asks the home of their trip to offer it to `person`. */
export async function requestAddition(
  userId: string,
  tripId: string,
  person: AddRequestBody
): Promise<{ requested: true; origin: string }> {
  await requireTripFederation(userId);
  const trip = await ownTripFor(prisma, userId, tripId);
  const group = trip.shareGroupId
    ? await prisma.tripShareGroup.findUnique({ where: { id: trip.shareGroupId } })
    : null;
  if (group && !group.homeOrigin)
    throw remoteShareError(
      "SHARE_REMOTE_IS_HOME",
      409,
      "This trip's home is this server; offer it from here",
      { userId }
    );
  const member = group
    ? await prisma.tripShareRemoteMember.findFirst({
        where: { groupId: group.id, remote: { userId }, state: { in: ["active", "unreachable"] } },
        include: { remote: true },
        orderBy: { createdAt: "asc" },
      })
    : null;
  if (!group?.federatedRef || !member)
    throw remoteShareError("SHARE_REMOTE_NOT_MEMBER", 409, "Not on this trip across servers", {
      userId,
    });
  const consenting = await acceptedParties(prisma, { kind: "user", id: userId }, [
    { kind: "remote", id: member.remoteId },
  ]);
  if (consenting.size === 0)
    throw remoteShareError(
      "SHARE_REMOTE_CONSENT_MISSING",
      409,
      "No accepted consent with that person",
      { userId, origin: member.remote.origin },
      { origin: member.remote.origin }
    );
  await requireAdmitted(userId, member.remote.origin);
  const groupRef = group.federatedRef;
  try {
    await sendOnStream(
      group.id,
      member.remote.origin,
      (seq) => ({
        kind: "add-request",
        ...messageHeader(),
        groupRef,
        seq,
        from: member.remote.localChannel,
        to: member.remote.channel,
        person: {
          displayName: person.displayName,
          ...(person.origin ? { origin: person.origin } : {}),
        },
        ...(person.note ? { note: person.note } : {}),
      }),
      TRIP_SHARE_TRANSPORT
    );
  } catch (error) {
    throw refusedThere(userId, member.remote.origin, error);
  }
  return { requested: true, origin: member.remote.origin };
}

/** The home: a request arrives; the member of that pairing gets it in their inbox. */
export const serveAddRequest = (
  origin: string,
  message: AddRequestMessage
): Promise<TripShareAck> =>
  serveOnce(origin, message, async (tx) => {
    const { group, pairing, member } = await addressed(tx, origin, message, "ours");
    requireReceiving(member);
    const trip = await tx.trip.findFirst({
      where: { userId: pairing.userId, shareGroupId: group.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    if (!trip) throw rejectWith("not-member");
    const consenting = await acceptedParties(tx, { kind: "user", id: pairing.userId }, [
      { kind: "remote", id: pairing.id },
    ]);
    if (consenting.size === 0) throw rejectWith("consent");
    await takeSeq(tx, group.id, origin, message.seq);
    await tx.shareNotice.create({
      data: {
        userId: pairing.userId,
        groupId: group.id,
        remoteActorId: pairing.id,
        kind: "add-request",
        entityType: "trip",
        entityKey: trip.id,
        after: {
          tripName: trip.name,
          person: message.person,
          ...(message.note ? { note: message.note } : {}),
          remoteActor: { displayName: pairing.displayName, origin: pairing.origin },
        },
      },
    });
  });
