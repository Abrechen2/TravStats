import { prisma } from "../../db";
import type { DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { Prisma } from "../../prisma";
import { consentRequired, hasAcceptedConsent } from "./consent";
import { copyMissing } from "./copyInto";
import { groupBookingTotals, type MemberBookingTotal } from "./bookingTotals";
import { detachTrip } from "./detach";
import { assignShareKeys } from "./keyOps";
import { SHARE_ENTITIES, SHARE_TYPES, emptyCounts, type CopyCounts } from "./shareTypes";
import { missingGroupConsent } from "./members";
import { tripFacts } from "./facts";
import { restatusTrips } from "../trip/restatusTrips";
import { PERSON_SELECT, toPerson, type SharePerson } from "./people";
import { tripPeople, type TripPerson } from "./tripPeople";

/**
 * Sharing one trip with a linked, consenting companion (design 2026-10-09,
 * decision 5) and leaving a share group again.
 *
 * Decision 1 is the shape of all of it: the recipient gets a COMPLETE trip of
 * their own — trip, flights, stays, cruises, rail and bus rides, rentals, stops —
 * joined to the sharer's by a `TripShareGroup` and, entry by entry, by a
 * common `shareKey`. Nothing is ever shared as one row between two accounts,
 * so every statistic keeps counting exactly the rows its user owns.
 */

/** Long enough for a trip of a few hundred entries; one transaction either way. */
const SHARE_TX_TIMEOUT_MS = 60_000;

const tripNotFound = () => new AppError("Trip not found", 404, "TRIP_NOT_FOUND", "tripId");

export interface ShareResult {
  groupId: string;
  /** False when the recipient already held a copy and only missing entries were added. */
  tripCreated: boolean;
  created: CopyCounts;
}

async function ownTrip(client: Pick<DbTransaction, "trip">, userId: string, tripId: string) {
  const trip = await client.trip.findFirst({ where: { id: tripId, userId } });
  if (!trip) throw tripNotFound();
  return trip;
}

/** The recipient's copy of the group's trip, created from the sharer's facts if missing. */
async function recipientTrip(
  tx: DbTransaction,
  owner: Prisma.TripGetPayload<object>,
  groupId: string,
  recipientId: string
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.trip.findFirst({
    where: { userId: recipientId, shareGroupId: groupId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return { id: existing.id, created: false };
  const created = await tx.trip.create({
    data: { ...tripFacts(owner), userId: recipientId, shareGroupId: groupId },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/**
 * Owner decision 2026-10-16: joining a group hands the newcomer writes into
 * every member's copy, so the sharer's consent alone does not admit them. Each
 * other current member must have an accepted consent with the recipient.
 */
async function requireGroupConsent(
  tx: DbTransaction,
  groupId: string,
  sharerId: string,
  recipientId: string
): Promise<void> {
  if ((await missingGroupConsent(tx, groupId, sharerId, recipientId)).length > 0) {
    throw new AppError(
      "Not every member of this trip has agreed to sharing with this account",
      403,
      "SHARE_GROUP_CONSENT_REQUIRED"
    );
  }
}

export async function shareTrip(
  userId: string,
  tripId: string,
  companionId: string
): Promise<ShareResult> {
  return prisma.$transaction(
    async (tx) => {
      const trip = await ownTrip(tx, userId, tripId);
      const companion = await tx.companion.findFirst({ where: { id: companionId, userId } });
      if (!companion) throw new AppError("Companion not found", 404, "COMPANION_NOT_FOUND");
      const recipientId = companion.linkedUserId;
      if (!recipientId) {
        throw new AppError(
          "This companion is not linked to an account",
          409,
          "SHARE_COMPANION_NOT_LINKED"
        );
      }
      // Same answer as `requestConsent` gives for a deactivated account.
      const recipient = await tx.user.findFirst({
        where: { id: recipientId, isActive: true },
        select: { id: true },
      });
      if (!recipient)
        throw new AppError("No such user on this server", 404, "SHARE_USER_NOT_FOUND");
      // Asked again on every share, not only when linking: a consent can be
      // withdrawn after the link was made.
      if (!(await hasAcceptedConsent(tx, userId, recipientId))) throw consentRequired();

      if (trip.shareGroupId) {
        await requireGroupConsent(tx, trip.shareGroupId, userId, recipientId);
      }
      let groupId = trip.shareGroupId;
      if (!groupId) {
        const group = await tx.tripShareGroup.create({ data: { createdById: userId } });
        groupId = group.id;
        await tx.trip.update({ where: { id: trip.id }, data: { shareGroupId: groupId } });
      }
      await assignShareKeys(tx, userId, trip.id);

      const target = await recipientTrip(tx, trip, groupId, recipientId);
      // Registry order: stops last, they resolve the entries they wrap by key.
      const created = emptyCounts();
      for (const entity of SHARE_ENTITIES) {
        const copied = await copyMissing(
          tx,
          entity,
          { userId, tripId: trip.id },
          { userId: recipientId, tripId: target.id }
        );
        created[SHARE_TYPES[entity].countKey] = copied.filter((e) => !e.joined).length;
      }
      await restatusTrips([target.id], tx);

      const anything = target.created || Object.values(created).some((n) => n > 0);
      if (anything) {
        await tx.shareNotice.create({
          data: {
            userId: recipientId,
            groupId,
            actorId: userId,
            kind: "shared",
            entityType: "trip",
            entityKey: target.id,
            after: { tripName: trip.name, tripCreated: target.created, created: { ...created } },
          },
        });
      }
      return { groupId, tripCreated: target.created, created };
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}

/**
 * Leave the group: the caller's copy stays as an ordinary trip (decision 5),
 * its keys and its group are cleared, every other member is told.
 */
export async function leaveGroup(userId: string, tripId: string): Promise<{ left: true }> {
  return prisma.$transaction(async (tx) => {
    const trip = await ownTrip(tx, userId, tripId);
    if (!trip.shareGroupId) {
      throw new AppError("This trip is not shared", 409, "SHARE_TRIP_NOT_SHARED");
    }
    await detachTrip(tx, userId, trip);
    return { left: true as const };
  });
}

export interface ShareCandidate {
  companionId: string;
  name: string;
  user: SharePerson;
  /** The linked account has accepted sharing from the caller. */
  consenting: boolean;
  /** The linked account already holds a copy of this trip. */
  shared: boolean;
}

export interface TripSharingView {
  groupId: string | null;
  /** The other members — never the caller, never their trip ids. */
  members: SharePerson[];
  candidates: ShareCandidate[];
  /** Companions and group members of the trip, each with their sharing state. */
  people: TripPerson[];
  /** Accounts that accepted the caller's consent request. */
  linkableUsers: SharePerson[];
  /** The other members' booking totals for their trip of the group, read-only (decision 2). */
  bookingTotals: MemberBookingTotal[];
}

/** Who holds this trip besides the caller, and whom the caller could share it with. */
export async function tripSharingView(userId: string, tripId: string): Promise<TripSharingView> {
  const trip = await ownTrip(prisma, userId, tripId);
  const [memberTrips, companions, consents] = await Promise.all([
    trip.shareGroupId
      ? prisma.trip.findMany({
          where: { shareGroupId: trip.shareGroupId, NOT: { userId } },
          select: { user: { select: PERSON_SELECT } },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    prisma.companion.findMany({
      where: { userId, linkedUserId: { not: null } },
      include: { linkedUser: { select: PERSON_SELECT } },
      orderBy: { displayName: "asc" },
    }),
    prisma.shareConsent.findMany({
      where: { requesterId: userId, status: "accepted" },
      select: { targetId: true },
    }),
  ]);
  const members = memberTrips.map((t) => toPerson(t.user));
  const memberIds = new Set(members.map((m) => m.id));
  const consenting = new Set(consents.map((c) => c.targetId));
  return {
    groupId: trip.shareGroupId,
    members,
    ...(await tripPeople(userId, trip)),
    bookingTotals: trip.shareGroupId ? await groupBookingTotals(trip.shareGroupId, userId) : [],
    candidates: companions.flatMap((c) =>
      c.linkedUser
        ? [
            {
              companionId: c.id,
              name: c.displayName,
              user: toPerson(c.linkedUser),
              consenting: consenting.has(c.linkedUser.id),
              shared: memberIds.has(c.linkedUser.id),
            },
          ]
        : []
    ),
  };
}
