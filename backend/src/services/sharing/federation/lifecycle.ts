/**
 * How a membership across servers ends, pauses and resumes (spec 2026-10-20 §4 `leave` /
 * `revoke`, §7, §8, O9; phase F-S4e).
 *
 * - **Leave** — a member's trip leaves its group here (`detachTrip`: leaving, deleting the trip,
 *   merging it away). Every membership through that member's pairings ends (`left`), its queued
 *   messages are deleted, and the other server is told (`leave`). The copies stay (decision 5).
 * - **Revoke** — a person withdraws the consent with someone on another server. Every membership
 *   of that pairing ends at once (`revoked`), its queued messages are deleted, the other server
 *   is told (`revoke`), and a copy on the spoke's side leaves its group. Nothing crosses after
 *   it in either direction: this side queues and accepts nothing more for the pairing, and the
 *   other side, told or not, is refused (`not-member`, `consent`).
 * - **Held** — a restore (§8), an admin blocking a server, or a re-pinned key (O9) suspends the
 *   memberships through it until their person confirms each trip again. Nothing is sent while
 *   held (the stream waits, its attempts are not counted) and a message that arrives is answered
 *   `suspended`, so the other server keeps it for later instead of losing it.
 * - **Confirm again** — the person resumes the trip's held memberships: the consent of the
 *   pairing is accepted again, the membership is active, and after a restore the home queues the
 *   trip's entries once more, because changes made while the membership was held were never
 *   queued (the receiver keeps only the entries it lacks).
 *
 * The end of a membership is told only where a message could still go: a membership held by a
 * restore or a blocked or re-pinned server is ended here without a word, and that server learns
 * it from the refusal of its next message.
 */
import { prisma, type DbTransaction } from "../../../db";
import { Prisma } from "../../../prisma";
import { requireTripFederation } from "./access";
import { kickDelivery } from "./deliveryKick";
import { queueEntries } from "./entries";
import { remoteShareError } from "./errors";
import { ownTripFor } from "./offerBuild";
import { requireAdmitted } from "./peerCheck";
import { HELD_REASONS, addressed, isHeld } from "./peerMember";
import { readRemotePerson, type RemotePersonView } from "./remotePeople";
import { queueRoster } from "./roster";
import { rejectWith, serveOnce, takeSeq } from "./streams";
import { detachTrip } from "../detach";
import type { LeaveMessage, RevokeMessage, TripShareAck } from "../../../schemas/tripSharePeer";

/** Memberships that end on a leave or a revoke: everything not ended already. */
const ENDABLE = ["invited", "active", "unreachable", "suspended"];

type MemberRow = Prisma.TripShareRemoteMemberGetPayload<{ include: { remote: true } }>;

/** Whether the other server can still be told: not held, not switched off there. */
const tellable = (m: MemberRow): boolean =>
  !isHeld(m) && ["invited", "active", "unreachable", "suspended"].includes(m.state);

/**
 * End one membership here: its queued messages go, the row becomes the tombstone a later message
 * is refused against, and — where it can still be told — the other server gets `leave`/`revoke`.
 */
async function endMembership(
  tx: DbTransaction,
  member: MemberRow,
  state: "left" | "revoked",
  tell: boolean
): Promise<void> {
  await tx.tripShareOutbox.deleteMany({ where: { memberId: member.id } });
  await tx.tripShareRemoteMember.update({
    where: { id: member.id },
    data: { state, stateReason: null, stateSince: new Date(), offer: Prisma.DbNull },
  });
  if (!tell) return;
  await tx.tripShareOutbox.create({
    data: {
      groupId: member.groupId,
      memberId: member.id,
      peerOrigin: member.remote.origin,
      kind: state === "left" ? "leave" : "revoke",
      payload: { from: member.remote.localChannel, to: member.remote.channel },
    },
  });
  kickDelivery();
}

/**
 * `userId`'s trip just left group `groupId` here (called by `detachTrip`, after the trip is out):
 * the memberships through their pairings end and are told; at the home, everyone else on other
 * servers gets the new roster.
 */
export async function departLocally(
  tx: DbTransaction,
  userId: string,
  groupId: string
): Promise<void> {
  const group = await tx.tripShareGroup.findUnique({ where: { id: groupId } });
  if (!group?.federatedRef) return;
  const members = await tx.tripShareRemoteMember.findMany({
    where: { groupId, remote: { userId }, state: { in: ENDABLE } },
    include: { remote: true },
  });
  for (const m of members) await endMembership(tx, m, "left", tellable(m));
}

/** At the home, after a member's trip left the group: the others learn the new roster. */
export async function rosterAfterDeparture(tx: DbTransaction, groupId: string): Promise<void> {
  const group = await tx.tripShareGroup.findUnique({ where: { id: groupId } });
  if (group?.federatedRef && !group.homeOrigin) await queueRoster(tx, groupId);
}

/** Tell every member here on the trip that the person behind `remoteId` is gone. */
async function noticeGone(
  tx: DbTransaction,
  groupId: string,
  pairing: { id: string; displayName: string; origin: string },
  revoked: boolean
): Promise<void> {
  const trips = await tx.trip.findMany({
    where: { shareGroupId: groupId },
    select: { id: true, userId: true, name: true },
  });
  if (trips.length === 0) return;
  await tx.shareNotice.createMany({
    data: trips.map((t) => ({
      userId: t.userId,
      groupId,
      remoteActorId: pairing.id,
      kind: "left",
      entityType: "trip",
      entityKey: t.id,
      after: {
        tripName: t.name,
        remoteActor: { displayName: pairing.displayName, origin: pairing.origin },
        ...(revoked ? { revoked: true } : {}),
      },
    })),
  });
}

/** A member on another server left the trip (`leave`). Their copy stays theirs. */
export const serveLeave = (origin: string, message: LeaveMessage): Promise<TripShareAck> =>
  serveOnce(origin, message, async (tx) => {
    const { group, pairing, member } = await addressed(tx, origin, message);
    if (!member) throw rejectWith("not-member");
    await takeSeq(tx, group.id, origin, message.seq);
    // Told twice, or after a revoke: already over.
    if (!ENDABLE.includes(member.state)) return;
    await endMembership(tx, { ...member, remote: pairing }, "left", false);
    await noticeGone(tx, group.id, pairing, false);
    if (!group.homeOrigin) await queueRoster(tx, group.id);
  });

/**
 * End every membership of one pairing as revoked, inside `tx`. On a spoke's side, the person's
 * copy of each such trip leaves its group (the receiver detaches, §7) unless another of their
 * pairings still carries it; at the home, the others get the new roster.
 */
async function revokePairing(
  tx: DbTransaction,
  pairing: { id: string; userId: string; displayName: string; origin: string },
  tell: boolean,
  notify: boolean
): Promise<void> {
  const now = new Date();
  await tx.shareConsent.updateMany({
    where: {
      status: { in: ["pending", "accepted"] },
      OR: [{ remoteRequesterId: pairing.id }, { remoteTargetId: pairing.id }],
    },
    data: { status: "withdrawn", decidedAt: now },
  });
  const members = await tx.tripShareRemoteMember.findMany({
    where: { remoteId: pairing.id, state: { in: ENDABLE } },
    include: { remote: true, group: true },
  });
  for (const m of members) {
    await endMembership(tx, m, "revoked", tell && tellable(m));
    if (notify) await noticeGone(tx, m.groupId, pairing, true);
    if (!m.group.homeOrigin) {
      await queueRoster(tx, m.groupId);
      continue;
    }
    const stillCarried = await tx.tripShareRemoteMember.count({
      where: { groupId: m.groupId, remote: { userId: pairing.userId }, state: { in: ENDABLE } },
    });
    if (stillCarried > 0) continue;
    const trips = await tx.trip.findMany({
      where: { userId: pairing.userId, shareGroupId: m.groupId },
      select: { id: true, name: true, shareGroupId: true },
    });
    for (const trip of trips) await detachTrip(tx, pairing.userId, trip);
  }
}

/** The other server withdrew the consent of a pairing (`revoke`). */
export const serveRevoke = (origin: string, message: RevokeMessage): Promise<TripShareAck> =>
  serveOnce(origin, message, async (tx) => {
    const { group, pairing, member } = await addressed(tx, origin, message);
    if (!member) throw rejectWith("not-member");
    await takeSeq(tx, group.id, origin, message.seq);
    // One revoke per shared group arrives; the first ended them all.
    await revokePairing(tx, pairing, false, true);
  });

/**
 * The caller withdraws their consent with a person on another server (Einstellungen → Reisen
 * teilen). Immediate here; the other server is told for every trip the two still share.
 */
export async function withdrawRemoteConsent(
  userId: string,
  remoteId: string
): Promise<RemotePersonView> {
  await requireTripFederation(userId);
  const pairing = await prisma.remoteShareAccount.findFirst({ where: { id: remoteId, userId } });
  if (!pairing)
    throw remoteShareError("SHARE_REMOTE_PERSON_NOT_FOUND", 404, "No such person", { userId });
  await prisma.$transaction((tx) => revokePairing(tx, pairing, true, false), { timeout: 30_000 });
  return readRemotePerson(userId, remoteId);
}

/**
 * Hold every membership through `origin` (O9): the admin blocked that server, or pinned a new key
 * for it. Nothing is sent or taken until each person confirms their trip again; the queue waits.
 */
export async function holdPeerMemberships(
  origin: string,
  reason: "peer-blocked" | "repinned"
): Promise<number> {
  const { count } = await prisma.tripShareRemoteMember.updateMany({
    where: {
      remote: { origin },
      OR: [
        { state: { in: ["active", "unreachable"] } },
        { state: "suspended", stateReason: { in: ["off", "peer-blocked", "repinned"] } },
      ],
    },
    data: { state: "suspended", stateReason: reason, stateSince: new Date() },
  });
  return count;
}

/**
 * A restore put the consent with a person on another server back to a question (§8); the
 * person's own confirmation answers it again. A withdrawn or declined consent stays as it is.
 */
export async function reacceptAfterRestore(
  c: Pick<DbTransaction, "shareConsent">,
  userId: string,
  remoteId: string
): Promise<void> {
  await c.shareConsent.updateMany({
    where: {
      status: "pending",
      OR: [
        { requesterId: userId, remoteTargetId: remoteId },
        { remoteRequesterId: remoteId, targetId: userId },
      ],
    },
    data: { status: "accepted", decidedAt: new Date() },
  });
}

/**
 * The caller confirms their held memberships of one trip again (after a restore, a block or a
 * re-pin). The server must be admitted and verified again first; the pairing's consent is
 * accepted again; after a restore the home queues the trip's entries once more.
 */
export async function reconfirmTrip(userId: string, tripId: string): Promise<number> {
  await requireTripFederation(userId);
  const trip = await ownTripFor(prisma, userId, tripId);
  const held = trip.shareGroupId
    ? await prisma.tripShareRemoteMember.findMany({
        where: {
          groupId: trip.shareGroupId,
          remote: { userId },
          state: "suspended",
          stateReason: { in: [...HELD_REASONS] },
        },
        include: { remote: true, group: true },
      })
    : [];
  if (held.length === 0)
    throw remoteShareError(
      "SHARE_REMOTE_NOTHING_TO_CONFIRM",
      409,
      "Nothing on this trip waits for a confirmation",
      { userId }
    );
  for (const origin of new Set(held.map((m) => m.remote.origin)))
    await requireAdmitted(userId, origin);
  const confirmed = await prisma.$transaction(
    async (tx) => {
      const now = new Date();
      // Read again under the rows' locks (F-S4e review): a leave or a revoke that ended one of
      // them since the first read wins, and nothing ended is brought back.
      const ids = held.map((m) => m.id);
      // The consents first, then the memberships — the order a withdrawal takes them in, so the
      // two wait for each other instead of deadlocking (F-S4e review, round 2).
      for (const remoteId of new Set(held.map((m) => m.remoteId)))
        await reacceptAfterRestore(tx, userId, remoteId);
      await tx.$queryRaw`SELECT 1 FROM trip_share_remote_members
        WHERE id = ANY(${ids}::text[]) ORDER BY id FOR NO KEY UPDATE`;
      const attached = await tx.trip.count({
        where: { id: trip.id, userId, shareGroupId: trip.shareGroupId },
      });
      const still = attached
        ? await tx.tripShareRemoteMember.findMany({
            where: { id: { in: ids }, state: "suspended", stateReason: { in: [...HELD_REASONS] } },
            include: { remote: true, group: true },
          })
        : [];
      for (const m of still) {
        const accepted = await tx.shareConsent.count({
          where: {
            status: "accepted",
            OR: [
              { requesterId: userId, remoteTargetId: m.remoteId },
              { remoteRequesterId: m.remoteId, targetId: userId },
            ],
          },
        });
        if (accepted === 0)
          throw remoteShareError(
            "SHARE_REMOTE_CONSENT_MISSING",
            409,
            "No accepted consent with that person",
            { userId, origin: m.remote.origin },
            { origin: m.remote.origin }
          );
        // An offer that was still open before the restore is open again, not accepted.
        const state = m.stateReason === "restore-invited" ? "invited" : "active";
        await tx.tripShareRemoteMember.update({
          where: { id: m.id },
          data: { state, stateReason: null, stateSince: now },
        });
        if (m.stateReason === "restore" && !m.group.homeOrigin) await queueEntries(tx, m.id);
      }
      // A restored home may name a roster older than the spokes': they get its own again.
      const restored = still.some((m) => m.stateReason === "restore");
      if (restored && !held[0].group.homeOrigin) await queueRoster(tx, held[0].groupId);
      return still.length;
    },
    { timeout: 60_000 }
  );
  if (confirmed === 0)
    throw remoteShareError(
      "SHARE_REMOTE_NOTHING_TO_CONFIRM",
      409,
      "Nothing on this trip waits for a confirmation",
      { userId }
    );
  kickDelivery();
  return confirmed;
}

/**
 * The caller dismisses the messages towards one member that were refused for good (parked): the
 * trip page stops naming them. They are not sent again.
 */
export async function dismissParked(
  userId: string,
  tripId: string,
  memberId: string
): Promise<number> {
  await requireTripFederation(userId);
  const trip = await ownTripFor(prisma, userId, tripId);
  const group = trip.shareGroupId
    ? await prisma.tripShareGroup.findUnique({ where: { id: trip.shareGroupId } })
    : null;
  // The members the caller's trip page shows (`tripRemoteSharing`): all at the home, their own
  // pairings on a spoke.
  const member = group
    ? await prisma.tripShareRemoteMember.findFirst({
        where: {
          id: memberId,
          groupId: group.id,
          ...(group.homeOrigin ? { remote: { userId } } : {}),
        },
      })
    : null;
  if (!member)
    throw remoteShareError("SHARE_REMOTE_PERSON_NOT_FOUND", 404, "No such member on this trip", {
      userId,
    });
  const { count } = await prisma.tripShareOutbox.deleteMany({
    where: { memberId, parkedAt: { not: null } },
  });
  return count;
}
