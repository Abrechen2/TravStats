import { prisma, type DbTransaction } from "../../db";
import type { RecordCheckDomain } from "../../schemas/dataQualityRecordChecks";
import {
  propagateDeletes,
  propagateWrite,
  propagateWrites,
  shareSnapshot,
  shareSnapshots,
  SHARE_TX_TIMEOUT_MS,
} from "../sharing/propagate";
import { recheckAchievements } from "../../utils/achievements";
import { findDuplicateCandidates } from "./checks/duplicateCandidates";
import { loadRecordSnapshot } from "./recordGather";
import { FindingActionError } from "./findingErrors";

/**
 * Merging the copies of a duplicate finding (spec C3, `merge`).
 *
 * One copy is kept; everything that hangs off the others and would otherwise
 * die with them moves onto it — kept originals (documents), the trip and
 * booking link when the kept copy has none, and per type: a flight's
 * companions, recording and public share links; a stay's roadtrip stations and
 * loyalty card. Then the other copies are deleted the way their own DELETE
 * deletes them (share snapshot, delete, notice to the members of a shared
 * trip), so sharing and achievements stay right.
 *
 * The kept copy's own fields are NOT filled from the others: which of two
 * different times or prices is right is the user's call, on the record's page.
 *
 * Not undoable on the server (owner, 2026-10-25): the app holds the request
 * for a few seconds instead.
 */

/**
 * `staleFinding` unless the copies are, right now, still one duplicate group.
 * The flag may be hours old; an edit since (another day, another number) means
 * the question it asked no longer stands, and merging on it would delete a
 * real entry.
 */
export async function assertStillDuplicates(
  userId: string,
  entityType: RecordCheckDomain,
  ids: readonly string[]
): Promise<void> {
  const snapshot = await loadRecordSnapshot(userId);
  const groups = new Map<string, Set<string>>();
  for (const finding of findDuplicateCandidates(snapshot)) {
    if (finding.kind !== "duplicate_candidate" || finding.entityType !== entityType) continue;
    groups.set(finding.entityId, new Set(finding.details.copies.map((c) => c.entityId)));
  }
  const holds = ids.every((id) =>
    ids.every((other) => id === other || groups.get(id)?.has(other) || groups.get(other)?.has(id))
  );
  if (!holds) throw new FindingActionError("staleFinding");
}

async function mergeFlights(
  tx: DbTransaction,
  userId: string,
  keptId: string,
  removedIds: readonly string[]
): Promise<void> {
  const rows = await tx.flight.findMany({
    where: { userId, id: { in: [keptId, ...removedIds] } },
    select: { id: true, tripId: true, bookingId: true, track: { select: { id: true } } },
  });
  const kept = rows.find((r) => r.id === keptId);
  const removed = rows.filter((r) => r.id !== keptId);
  if (!kept || removed.length !== removedIds.length) throw new FindingActionError("staleFinding");

  await tx.document.updateMany({
    where: { userId, flightId: { in: [...removedIds] } },
    data: { flightId: keptId },
  });
  await tx.publicShareLink.updateMany({
    where: { userId, flightId: { in: [...removedIds] } },
    data: { flightId: keptId },
  });
  const companions = await tx.flightCompanion.findMany({
    where: { flightId: { in: [...removedIds] } },
    select: { companionId: true, position: true },
  });
  if (companions.length > 0) {
    await tx.flightCompanion.createMany({
      data: companions.map((c) => ({
        flightId: keptId,
        companionId: c.companionId,
        position: c.position,
      })),
      skipDuplicates: true,
    });
  }
  const withTrack = removed.find((r) => r.track);
  if (!kept.track && withTrack) {
    await tx.flightTrack.update({ where: { flightId: withTrack.id }, data: { flightId: keptId } });
  }

  const tripId = kept.tripId ?? removed.find((r) => r.tripId)?.tripId ?? null;
  const bookingId = kept.bookingId ?? removed.find((r) => r.bookingId)?.bookingId ?? null;
  if (tripId !== kept.tripId || bookingId !== kept.bookingId) {
    const before = await shareSnapshot(tx, "flight", keptId);
    await tx.flight.update({ where: { id: keptId }, data: { tripId, bookingId } });
    await propagateWrite(tx, userId, "flight", keptId, before);
  }

  const gone = await shareSnapshots(tx, "flight", [...removedIds]);
  await tx.flight.deleteMany({ where: { userId, id: { in: [...removedIds] } } });
  await propagateDeletes(tx, userId, [...gone.values()]);
}

async function mergeStays(
  tx: DbTransaction,
  userId: string,
  keptId: string,
  removedIds: readonly string[]
): Promise<void> {
  const rows = await tx.lodgingStay.findMany({
    where: { userId, id: { in: [keptId, ...removedIds] } },
    select: { id: true, tripId: true, bookingId: true, membershipId: true },
  });
  const kept = rows.find((r) => r.id === keptId);
  const removed = rows.filter((r) => r.id !== keptId);
  if (!kept || removed.length !== removedIds.length) throw new FindingActionError("staleFinding");

  await tx.document.updateMany({
    where: { userId, lodgingStayId: { in: [...removedIds] } },
    data: { lodgingStayId: keptId },
  });
  const stations = await tx.tripStop.findMany({
    where: { lodgingStayId: { in: [...removedIds] } },
    select: { id: true },
  });
  if (stations.length > 0) {
    const ids = stations.map((s) => s.id);
    const before = await shareSnapshots(tx, "stop", ids);
    await tx.tripStop.updateMany({ where: { id: { in: ids } }, data: { lodgingStayId: keptId } });
    await propagateWrites(tx, userId, "stop", ids, before);
  }

  const pick = <K extends "tripId" | "bookingId" | "membershipId">(key: K) =>
    kept[key] ?? removed.find((r) => r[key])?.[key] ?? null;
  const links = {
    tripId: pick("tripId"),
    bookingId: pick("bookingId"),
    membershipId: pick("membershipId"),
  };
  if (
    links.tripId !== kept.tripId ||
    links.bookingId !== kept.bookingId ||
    links.membershipId !== kept.membershipId
  ) {
    const before = await shareSnapshot(tx, "lodgingStay", keptId);
    await tx.lodgingStay.update({ where: { id: keptId }, data: links });
    await propagateWrite(tx, userId, "lodgingStay", keptId, before);
  }

  const gone = await shareSnapshots(tx, "lodgingStay", [...removedIds]);
  await tx.lodgingStay.deleteMany({ where: { userId, id: { in: [...removedIds] } } });
  await propagateDeletes(tx, userId, [...gone.values()]);
}

/**
 * Merge `removedIds` into `keptId`, then run `alsoInTx` — the flag answer — in
 * the same transaction, so the data and the answer change together or not at
 * all.
 */
export async function mergeDuplicates(
  userId: string,
  entityType: RecordCheckDomain,
  keptId: string,
  removedIds: readonly string[],
  alsoInTx: (tx: DbTransaction) => Promise<void>
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      if (entityType === "flight") await mergeFlights(tx, userId, keptId, removedIds);
      else if (entityType === "lodging_stay") await mergeStays(tx, userId, keptId, removedIds);
      else throw new FindingActionError("invalidAction", "notOffered");
      await alsoInTx(tx);
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  await recheckAchievements(userId, `merge ${entityType}`);
}
