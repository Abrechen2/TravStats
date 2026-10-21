/**
 * The home side of offering a trip to a person on another server (spec 2026-10-20 §4, §5,
 * phase F-S4c): offer it from the trip page, take the person's answer, and on a yes queue the
 * entries (`entries.ts`, delivered by the outbox since F-S4d).
 *
 * The person decides on their own server (`offer-answer`): an offer creates nothing in their
 * account, and a declined or unanswered one never will. No network call runs inside a database
 * transaction; the member row is written before the offer leaves and undone if it does not
 * arrive, so the trip page never shows an offer the other server has not got.
 */
import { prisma } from "../../../db";
import { acceptedParties } from "../members";
import type { OfferAnswer, TripShareAck } from "../../../schemas/tripSharePeer";
import { requireTripFederation } from "./access";
import { kickDelivery } from "./deliveryKick";
import { queueEntries } from "./entries";
import { remoteShareError } from "./errors";
import {
  buildOfferBody,
  ensureFederatedGroup,
  ownTripFor,
  requireHome,
  undoNewGroup,
} from "./offerBuild";
import { peerFailure, requireAdmitted, requireTripSharePeer } from "./peerCheck";
import { readRemoteMember, type RemoteMemberView } from "./remoteMemberView";
import { StreamRejected, rejectWith, sendOnStream, serveOnce, takeSeq } from "./streams";
import { OFFER_TRANSPORT, messageHeader } from "./transport";

/** Keying a trip of up to 500 entries on first offer, in one transaction. */
const KEYING_TX = { timeout: 60_000 } as const;

/** The caller's pairing `remoteId` with an accepted consent, or the reason it cannot be offered. */
async function consentingPairing(userId: string, remoteId: string) {
  const remote = await prisma.remoteShareAccount.findFirst({ where: { id: remoteId, userId } });
  if (!remote)
    throw remoteShareError("SHARE_REMOTE_PERSON_NOT_FOUND", 404, "No such person", { userId });
  const accepted = await acceptedParties(prisma, { kind: "user", id: userId }, [
    { kind: "remote", id: remote.id },
  ]);
  if (accepted.size === 0)
    throw remoteShareError(
      "SHARE_REMOTE_CONSENT_MISSING",
      409,
      "No accepted consent with that person",
      { userId, origin: remote.origin },
      { origin: remote.origin }
    );
  return remote;
}

/** What the other server's refusal of a message reads as, to the user who sent it. */
export function refusedThere(userId: string, origin: string, error: unknown): unknown {
  if (error instanceof StreamRejected)
    return remoteShareError(
      "SHARE_REMOTE_REFUSED",
      409,
      "The other server refused the message",
      { userId, origin, kind: error.ack.rejected },
      { origin, reason: error.ack.rejected }
    );
  return peerFailure(userId, origin, error);
}

/**
 * Offer the caller's trip to a person on another server they are paired with. Sending it again
 * while they have not answered (or after they declined) is allowed — it is the way to re-ask, and
 * the way an offer lost on the way gets there.
 */
export async function offerTrip(
  userId: string,
  tripId: string,
  remoteId: string
): Promise<RemoteMemberView> {
  const local = await requireTripFederation(userId);
  const trip = await ownTripFor(prisma, userId, tripId);
  await requireHome(prisma, userId, trip.shareGroupId);
  const remote = await consentingPairing(userId, remoteId);
  if (trip.shareGroupId) {
    const member = await prisma.tripShareRemoteMember.findUnique({
      where: { groupId_remoteId: { groupId: trip.shareGroupId, remoteId } },
    });
    if (member?.state === "active")
      throw remoteShareError("SHARE_REMOTE_ALREADY_MEMBER", 409, "Already on this trip", {
        userId,
      });
  }
  await requireAdmitted(userId, remote.origin);
  await requireTripSharePeer(userId, remote.origin);

  const prepared = await prisma.$transaction(async (tx) => {
    const group = await ensureFederatedGroup(tx, userId, trip);
    const before = await tx.tripShareRemoteMember.findUnique({
      where: { groupId_remoteId: { groupId: group.id, remoteId } },
    });
    const member = await tx.tripShareRemoteMember.upsert({
      where: { groupId_remoteId: { groupId: group.id, remoteId } },
      create: { groupId: group.id, remoteId },
      update: { state: "invited", stateReason: null, stateSince: new Date() },
    });
    const body = await buildOfferBody(tx, local.origin, userId, trip, group.id);
    return { group, before, member, body };
  }, KEYING_TX);

  try {
    await sendOnStream(
      prepared.group.id,
      remote.origin,
      (seq) => ({
        kind: "offer",
        ...messageHeader(),
        groupRef: prepared.group.federatedRef,
        seq,
        from: remote.localChannel,
        to: remote.channel,
        ...prepared.body,
      }),
      OFFER_TRANSPORT
    );
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      if (prepared.before) {
        const { state, stateReason, stateSince } = prepared.before;
        await tx.tripShareRemoteMember.update({
          where: { id: prepared.member.id },
          data: { state, stateReason, stateSince },
        });
      } else await tx.tripShareRemoteMember.delete({ where: { id: prepared.member.id } });
      await undoNewGroup(tx, trip.id, prepared.group);
    });
    throw refusedThere(userId, remote.origin, error);
  }
  return readRemoteMember(prepared.member.id);
}

/**
 * The person's answer arrives from their server. Accept turns the member active and, once the
 * write commits, its entries are in the outbox; a repeated accept (an answer whose reply was lost)
 * queues them again — the receiver keeps only what it lacks. Decline copies nothing, ever.
 */
export function serveOfferAnswer(origin: string, message: OfferAnswer): Promise<TripShareAck> {
  return serveOnce(origin, message, async (tx) => {
    const group = await tx.tripShareGroup.findFirst({
      where: { federatedRef: message.groupRef, homeOrigin: null },
    });
    if (!group) throw rejectWith("not-member");
    const member = await tx.tripShareRemoteMember.findFirst({
      where: {
        groupId: group.id,
        remote: { origin, channel: message.from, localChannel: message.to },
      },
      include: { remote: { select: { userId: true } } },
    });
    const answerable = message.answer === "accept" ? ["invited", "active"] : ["invited"];
    if (!member || !answerable.includes(member.state)) throw rejectWith("not-member");
    await takeSeq(tx, group.id, origin, message.seq);
    const now = new Date();
    if (message.answer === "decline") {
      await tx.tripShareRemoteMember.update({
        where: { id: member.id },
        data: { state: "declined", stateReason: null, stateSince: now },
      });
      return;
    }
    const consenting = await acceptedParties(tx, { kind: "user", id: member.remote.userId }, [
      { kind: "remote", id: member.remoteId },
    ]);
    if (consenting.size === 0) throw rejectWith("consent");
    if (member.state !== "active")
      await tx.tripShareRemoteMember.update({
        where: { id: member.id },
        data: { state: "active", stateReason: null, stateSince: now },
      });
    // The entries leave with this write: queued in its transaction, sent once it commits.
    await queueEntries(tx, member.id);
    return { after: kickDelivery };
  });
}
