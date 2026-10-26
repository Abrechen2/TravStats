import type { DbTransaction } from "../../db";
import { Prisma, type DataQualityFlag } from "../../prisma";
import { ferryMatchDetailsSchema } from "../../schemas/dataQualityRecordChecks";
import { propagateWrite, shareSnapshot } from "../sharing/propagate";
import { findFerryMatches } from "./checks/ferryMatch";
import { FindingActionError } from "./findingErrors";
import { loadRecordSnapshot } from "./recordGather";

/**
 * `link` for a ferry match (spec C3): put the ride on the candidate trip, and
 * take it off again on undo. Both run inside the caller's transaction, with
 * the flag's answer, and propagate like the ferry PATCH does — a shared
 * trip's members get the ride.
 *
 * `link` asks the check again, on locked rows: the flag may be hours old, and
 * since then the crossing may have moved out of the trip's days, been
 * cancelled, or a second trip may now hold it. Unless the rule still names
 * this ride and this one trip, the answer is `staleFinding`. The writes are
 * conditional on the state they expect (on no trip and no roadtrip leg; on
 * the linked trip for an undo), so a change that slips in anyway matches
 * nothing and is refused rather than overwritten.
 */
export interface FerryLink {
  entityType: "ferry_journey";
  id: string;
  tripId: string;
}

async function lockRideAndTrip(tx: DbTransaction, rideId: string, tripId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ferry_journeys" WHERE id = ${rideId} FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "trips" WHERE id = ${tripId} FOR UPDATE`);
}

export async function applyFerryLink(tx: DbTransaction, flag: DataQualityFlag): Promise<FerryLink> {
  const details = ferryMatchDetailsSchema.safeParse(flag.details);
  if (!details.success) throw new FindingActionError("staleFinding");
  const { ferryId, candidateTripId } = details.data;

  await lockRideAndTrip(tx, ferryId, candidateTripId);
  // Through the transaction: never a second pool connection while locked.
  const snapshot = await loadRecordSnapshot(flag.userId, tx);
  const still = findFerryMatches(snapshot).find((f) => f.entityId === ferryId);
  if (!still || still.kind !== "ferry_match" || still.details.candidateTripId !== candidateTripId) {
    throw new FindingActionError("staleFinding");
  }

  const before = await shareSnapshot(tx, "ferry", ferryId);
  const linked = await tx.ferryJourney.updateMany({
    where: { id: ferryId, userId: flag.userId, tripId: null, roadtripLegId: null },
    data: { tripId: candidateTripId },
  });
  if (linked.count === 0) throw new FindingActionError("staleFinding");
  await propagateWrite(tx, flag.userId, "ferry", ferryId, before);
  // The caller re-derives the trip's status after commit (`restatusTrips`).
  return { entityType: "ferry_journey", id: ferryId, tripId: candidateTripId };
}

export async function undoFerryLink(
  tx: DbTransaction,
  userId: string,
  link: { id: string; tripId: string }
): Promise<void> {
  // Lock first: the snapshot propagation reads and the conditional write
  // below must see the same trip, or a removal notice goes to the wrong group.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ferry_journeys" WHERE id = ${link.id} FOR UPDATE`);
  const before = await shareSnapshot(tx, "ferry", link.id);
  // Only while the ride is still on the trip the link put it on, and on no
  // roadtrip leg: a ride the user has moved or attached to a leg since keeps
  // the user's choice (a leg's ride must stay on the leg's trip).
  const unlinked = await tx.ferryJourney.updateMany({
    where: { id: link.id, userId, tripId: link.tripId, roadtripLegId: null },
    data: { tripId: null },
  });
  if (unlinked.count === 0) throw new FindingActionError("staleFinding");
  await propagateWrite(tx, userId, "ferry", link.id, before);
}
