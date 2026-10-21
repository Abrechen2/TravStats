/**
 * A spoke asks the home for the trip's current state (spec 2026-10-20, Q4/Q5 catch-up of
 * 2026-10-21): `resync`, spoke → home, through the outbox.
 *
 * Spoke: queued when the person says yes to someone on the roster (what that person changed
 * before the yes was withheld) and when the person confirms the trip again after this server was
 * restored (what arrived after the dump is gone). It names the roster refs the person agreed to.
 *
 * Home: checked like any group message from that pairing — the membership must take messages,
 * the consent must hold, the seq is taken — and answered by queueing the current state for that
 * member (`queueEntries` with `resync`): only entries brought in by people the person may see,
 * and not again while an earlier answer still waits. The spoke compares what it holds
 * (`resyncApply.ts`).
 */
import type { DbTransaction } from "../../../db";
import type { Prisma } from "../../../prisma";
import { acceptedParties, QUEUEABLE } from "../members";
import {
  MAX_ROSTER,
  type EntriesUpMessage,
  type ResyncMessage,
  type TripShareAck,
} from "../../../schemas/tripSharePeer";
import { kickDelivery } from "./deliveryKick";
import { queueEntries } from "./entries";
import { addressed, requireReceiving } from "./peerMember";
import { rejectWith, serveOnce, takeSeq } from "./streams";

/**
 * A message from a spoke's pairing to this home (`resync`, `entries-up`): the group must be ours,
 * the membership must take messages, the person here must still have the trip and their consent
 * with the pairing must hold — then the seq is taken. As for a received change (`inbound.ts`).
 */
export async function fromSpoke(
  tx: DbTransaction,
  origin: string,
  message: ResyncMessage | EntriesUpMessage
) {
  const { group, pairing, member } = await addressed(tx, origin, message, "ours");
  const live = requireReceiving(member);
  const trip = await tx.trip.findFirst({
    where: { userId: pairing.userId, shareGroupId: group.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true },
  });
  if (!trip) throw rejectWith("not-member");
  const consenting = await acceptedParties(tx, { kind: "user", id: pairing.userId }, [
    { kind: "remote", id: pairing.id },
  ]);
  if (consenting.size === 0) throw rejectWith("consent");
  await takeSeq(tx, group.id, origin, message.seq);
  return { group, pairing, member: live, trip };
}

/**
 * Spoke: ask the home for the current state of group `groupId`, for `userId`, through each of
 * their memberships whose messages queue. Not queued again while an earlier request still waits.
 */
export async function queueResync(
  tx: DbTransaction,
  userId: string,
  groupId: string
): Promise<number> {
  const group = await tx.tripShareGroup.findUnique({ where: { id: groupId } });
  if (!group?.federatedRef || !group.homeOrigin) return 0;
  const members = await tx.tripShareRemoteMember.findMany({
    where: { groupId, remote: { userId }, ...QUEUEABLE },
    include: { remote: true },
  });
  if (members.length === 0) return 0;
  const accepted = (
    await tx.tripShareRosterConsent.findMany({
      where: { groupId, userId, status: "accepted" },
      select: { ref: true },
      orderBy: { decidedAt: "desc" },
      take: MAX_ROSTER,
    })
  ).map((c) => c.ref);
  let queued = 0;
  for (const m of members) {
    // A waiting request that already names every yes answers this one too; one from before a
    // newer yes does not, so a fresh one follows it (review 2).
    const waiting = await tx.tripShareOutbox.findMany({
      where: { memberId: m.id, kind: "resync", parkedAt: null },
      select: { payload: true },
    });
    const covers = waiting.some((w) => {
      const named = new Set((w.payload as { accepted?: string[] }).accepted ?? []);
      return accepted.every((ref) => named.has(ref));
    });
    if (covers) continue;
    await tx.tripShareOutbox.create({
      data: {
        groupId,
        memberId: m.id,
        peerOrigin: m.remote.origin,
        kind: "resync",
        payload: {
          from: m.remote.localChannel,
          to: m.remote.channel,
          accepted,
        } as Prisma.InputJsonValue,
      },
    });
    queued++;
  }
  if (queued > 0) kickDelivery();
  return queued;
}

/** Home: a spoke asks for the trip's current state. */
export const serveResync = (origin: string, message: ResyncMessage): Promise<TripShareAck> =>
  serveOnce(origin, message, async (tx) => {
    const { member } = await fromSpoke(tx, origin, message);
    await queueEntries(tx, member.id, { resync: { accepted: message.accepted } });
    return { after: kickDelivery };
  });
