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
import { PERSON_SELECT, toPerson } from "../people";
import { SHARE_ENTITIES, SHARE_TYPES, emptyCounts, type CopyCounts } from "../shareTypes";
import { MAX_ENTRIES_PER_TRIP, type TripOffer } from "../../../schemas/tripSharePeer";
import { encodeShape } from "./wire/codec";
import { TRIP_SHAPE } from "./wire/shapes";
import { remoteShareError } from "./errors";

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

/** The trip's group with a wire ref, created and/or given a ref if it has none yet. */
export async function ensureFederatedGroup(
  tx: DbTransaction,
  userId: string,
  trip: { id: string; shareGroupId: string | null }
): Promise<FederatedGroup> {
  if (trip.shareGroupId) {
    const group = await tx.tripShareGroup.findUniqueOrThrow({ where: { id: trip.shareGroupId } });
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

/** Undo `ensureFederatedGroup` for an offer that did not arrive: the trip is unshared again. */
export async function undoNewGroup(
  tx: DbTransaction,
  tripId: string,
  group: FederatedGroup
): Promise<void> {
  if (!group.created) return;
  await tx.trip.update({ where: { id: tripId }, data: { shareGroupId: null } });
  await tx.tripShareGroup.delete({ where: { id: group.id } });
}

type OfferBody = Pick<TripOffer, "trip" | "roster" | "counts">;

/**
 * The trip's facts, who is on it, and what it holds. Keys are assigned here (as a local share
 * does on first share), so the counts are of the entries that will travel. More than
 * `MAX_ENTRIES_PER_TRIP` is refused before anything is sent.
 */
export async function buildOfferBody(
  tx: DbTransaction,
  localOrigin: string,
  userId: string,
  trip: Parameters<typeof tripFacts>[0] & { id: string },
  groupId: string
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
  const [locals, remotes] = await Promise.all([
    tx.trip.findMany({
      where: { shareGroupId: groupId },
      select: { user: { select: PERSON_SELECT } },
      orderBy: { createdAt: "asc" },
    }),
    tx.tripShareRemoteMember.findMany({
      where: { groupId, state: "active" },
      select: { remote: { select: { displayName: true, origin: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    trip: encodeShape(TRIP_SHAPE, tripFacts(trip)),
    roster: [
      ...locals.map((t) => ({ displayName: toPerson(t.user).displayName, origin: localOrigin })),
      ...remotes.map((r) => r.remote),
    ].slice(0, 50),
    counts,
  };
}
