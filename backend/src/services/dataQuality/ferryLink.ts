import type { DbTransaction } from "../../db";
import type { DataQualityFlag } from "../../prisma";
import { ferryMatchDetailsSchema } from "../../schemas/dataQualityRecordChecks";
import { propagateWrite, shareSnapshot } from "../sharing/propagate";
import { restatusTrips } from "../trip/restatusTrips";
import { FindingActionError } from "./findingErrors";

/**
 * `link` for a ferry match (spec C3): put the ride on the candidate trip, and
 * take it off again on undo. Both run inside the caller's transaction, with
 * the flag's answer, and propagate like the ferry PATCH does — a shared
 * trip's members get the ride.
 *
 * Both refuse with `staleFinding` when the ride moved meanwhile: linked to
 * some trip already, or (undo) no longer on the trip the link put it on —
 * undoing then would take away a link the user made themselves.
 */
export interface FerryLink {
  entityType: "ferry_journey";
  id: string;
  tripId: string;
}

export async function applyFerryLink(tx: DbTransaction, flag: DataQualityFlag): Promise<FerryLink> {
  const details = ferryMatchDetailsSchema.safeParse(flag.details);
  if (!details.success) throw new FindingActionError("staleFinding");
  const { ferryId, candidateTripId } = details.data;
  const [ride, trip] = await Promise.all([
    tx.ferryJourney.findFirst({
      where: { id: ferryId, userId: flag.userId },
      select: { tripId: true, roadtripLegId: true },
    }),
    tx.trip.findFirst({
      where: { id: candidateTripId, userId: flag.userId },
      select: { id: true },
    }),
  ]);
  if (!ride || !trip || ride.tripId !== null || ride.roadtripLegId !== null) {
    throw new FindingActionError("staleFinding");
  }
  const before = await shareSnapshot(tx, "ferry", ferryId);
  await tx.ferryJourney.update({ where: { id: ferryId }, data: { tripId: candidateTripId } });
  await propagateWrite(tx, flag.userId, "ferry", ferryId, before);
  // A ride extends its trip's span — the ferry routes do the same.
  await restatusTrips([candidateTripId], tx);
  return { entityType: "ferry_journey", id: ferryId, tripId: candidateTripId };
}

export async function undoFerryLink(
  tx: DbTransaction,
  userId: string,
  link: { id: string; tripId: string }
): Promise<void> {
  const ride = await tx.ferryJourney.findFirst({
    where: { id: link.id, userId },
    select: { tripId: true },
  });
  if (!ride || ride.tripId !== link.tripId) throw new FindingActionError("staleFinding");
  const before = await shareSnapshot(tx, "ferry", link.id);
  await tx.ferryJourney.update({ where: { id: link.id }, data: { tripId: null } });
  await propagateWrite(tx, userId, "ferry", link.id, before);
  await restatusTrips([link.tripId], tx);
}
