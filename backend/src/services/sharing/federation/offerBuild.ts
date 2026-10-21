/**
 * What the home server puts into an offer (spec 2026-10-20 §4 `offer`): the group's wire ref,
 * the trip's own facts, the roster and how many entries of each type wait — no entry yet.
 * Shared by the offer from a trip page (`offers.ts`) and the offer a trip page's invitation
 * carries inside the claim reply (`invites.ts`).
 */
import { randomUUID } from "crypto";
import type { DbTransaction } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { tripFacts } from "../facts";
import { assignShareKeys, keyedIdsOnTrip } from "../keyOps";
import { SHARE_ENTITIES, SHARE_TYPES, emptyCounts, type CopyCounts } from "../shareTypes";
import { MAX_ENTRIES_PER_TRIP, type TripOffer } from "../../../schemas/tripSharePeer";
import { encodeShape } from "./wire/codec";
import { TRIP_SHAPE } from "./wire/shapes";
import { remoteShareError } from "./errors";
import { homeRoster, userRef } from "./roster";

export interface FederatedGroup {
  id: string;
  federatedRef: string;
  /** Made for this offer — to be undone if the offer does not arrive. */
  created: boolean;
}

/** The caller's own trip, or `TRIP_NOT_FOUND`. */
export async function ownTripFor(c: Pick<DbTransaction, "trip">, userId: string, tripId: string) {
  const trip = await c.trip.findFirst({ where: { id: tripId, userId } });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND", "tripId");
  return trip;
}

/**
 * Only the home server offers a group's trip to someone new (F5): a trip that came from another
 * server is offered on from there (`add-request`, F-S4e).
 */
export async function requireHome(
  c: Pick<DbTransaction, "tripShareGroup">,
  userId: string,
  groupId: string | null
): Promise<void> {
  if (!groupId) return;
  const group = await c.tripShareGroup.findUnique({ where: { id: groupId } });
  if (group?.homeOrigin)
    throw remoteShareError(
      "SHARE_REMOTE_NOT_HOME",
      409,
      "This trip came from another server; it is offered on from there",
      { userId },
      { origin: group.homeOrigin }
    );
}

/**
 * The trip's group with a wire ref, created and/or given a ref if it has none yet. The trip row
 * is locked and read again here, and so is its group: two first offers at once (to two people,
 * or an offer and a claim) otherwise each made a group and the trip kept only the last, leaving
 * the first person's membership on a group the trip no longer belonged to.
 */
export async function ensureFederatedGroup(
  tx: DbTransaction,
  userId: string,
  trip: { id: string }
): Promise<FederatedGroup> {
  await tx.$queryRaw`SELECT 1 FROM trips WHERE id = ${trip.id} FOR UPDATE`;
  const { shareGroupId } = await tx.trip.findUniqueOrThrow({
    where: { id: trip.id },
    select: { shareGroupId: true },
  });
  if (shareGroupId) {
    await tx.$queryRaw`SELECT 1 FROM trip_share_groups WHERE id = ${shareGroupId} FOR UPDATE`;
    const group = await tx.tripShareGroup.findUniqueOrThrow({ where: { id: shareGroupId } });
    if (group.federatedRef)
      return { id: group.id, federatedRef: group.federatedRef, created: false };
    const federatedRef = randomUUID();
    await tx.tripShareGroup.update({ where: { id: group.id }, data: { federatedRef } });
    return { id: group.id, federatedRef, created: false };
  }
  const group = await tx.tripShareGroup.create({
    data: { createdById: userId, federatedRef: randomUUID() },
  });
  await tx.trip.update({ where: { id: trip.id }, data: { shareGroupId: group.id } });
  return { id: group.id, federatedRef: group.federatedRef as string, created: true };
}

/**
 * Undo `ensureFederatedGroup` for an offer that did not arrive: the trip is unshared again — but
 * only while the trip is still in that group and nobody else joined it meanwhile (an offer made
 * at the same time, which found this group, must keep it).
 */
export async function undoNewGroup(
  tx: DbTransaction,
  tripId: string,
  group: FederatedGroup
): Promise<void> {
  if (!group.created) return;
  await tx.$queryRaw`SELECT 1 FROM trips WHERE id = ${tripId} FOR UPDATE`;
  const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { shareGroupId: true } });
  if (trip?.shareGroupId !== group.id) return;
  const remoteMembers = await tx.tripShareRemoteMember.count({ where: { groupId: group.id } });
  const otherTrips = await tx.trip.count({
    where: { shareGroupId: group.id, id: { not: tripId } },
  });
  if (remoteMembers > 0 || otherTrips > 0) return;
  await tx.trip.update({ where: { id: tripId }, data: { shareGroupId: null } });
  await tx.tripShareGroup.delete({ where: { id: group.id } });
}

type OfferBody = Pick<TripOffer, "trip" | "roster" | "counts" | "self" | "you">;

/**
 * The trip's facts, who is on it, and what it holds. Keys are assigned here (as a local share
 * does on first share), so the counts are of the entries that will travel. More than
 * `MAX_ENTRIES_PER_TRIP` is refused before anything is sent. The roster names everyone by their
 * ref in this group (F-S4e), and `self` / `you` say which of them the two ends of this pairing
 * are.
 */
export async function buildOfferBody(
  tx: DbTransaction,
  localOrigin: string,
  userId: string,
  trip: Parameters<typeof tripFacts>[0] & { id: string },
  group: { id: string; federatedRef: string },
  member: { rosterRef: string }
): Promise<OfferBody> {
  await assignShareKeys(tx, userId, trip.id);
  const counts: CopyCounts = emptyCounts();
  let total = 0;
  for (const entity of SHARE_ENTITIES) {
    const n = (await keyedIdsOnTrip(tx, entity, userId, trip.id)).length;
    counts[SHARE_TYPES[entity].countKey] = n;
    total += n;
  }
  if (total > MAX_ENTRIES_PER_TRIP)
    throw remoteShareError(
      "SHARE_REMOTE_TRIP_TOO_LARGE",
      409,
      `A trip of more than ${MAX_ENTRIES_PER_TRIP} entries cannot be offered to another server`,
      { userId }
    );
  return {
    trip: encodeShape(TRIP_SHAPE, tripFacts(trip)),
    roster: await homeRoster(tx, group, localOrigin),
    self: userRef(group.federatedRef, userId),
    you: member.rosterRef,
    counts,
  };
}
