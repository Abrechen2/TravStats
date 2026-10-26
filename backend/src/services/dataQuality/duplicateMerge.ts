import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
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
 * real entry. Called inside the merge transaction AFTER `lockCopies`: the
 * snapshot reads committed rows, and the locked copies cannot change until
 * the merge commits.
 */
async function assertStillDuplicates(
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

/**
 * `conflictingLinks` when the copies name DIFFERENT trips, bookings or cards.
 * Keeping one would silently drop the other association; which one is right
 * is the user's call. One copy with a link and the rest without is fine — the
 * kept copy takes it over.
 */
function assertOneLink<K extends string>(
  rows: readonly Record<K, string | null>[],
  keys: readonly K[]
): void {
  for (const key of keys) {
    if (new Set(rows.map((r) => r[key]).filter((v) => v !== null)).size > 1) {
      throw new FindingActionError("invalidAction", "conflictingLinks");
    }
  }
}

const TABLE: Partial<Record<RecordCheckDomain, string>> = {
  flight: "flights",
  lodging_stay: "lodging_stays",
};

/**
 * Lock the copies for the rest of the transaction (`FOR UPDATE`), so no edit
 * can land between the check that they are still one entry and the delete.
 * An edit already in flight is waited for, then seen by the check.
 */
async function lockCopies(
  tx: DbTransaction,
  entityType: RecordCheckDomain,
  userId: string,
  ids: readonly string[]
): Promise<void> {
  const table = TABLE[entityType];
  if (!table) throw new FindingActionError("invalidAction", "notOffered");
  const locked = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE user_id = ${userId} AND id IN (${Prisma.join([...ids])}) FOR UPDATE`
  );
  if (locked.length !== ids.length) throw new FindingActionError("staleFinding");
}

/**
 * Point this account's stops (on its trips or its tours) that reference a
 * removed copy at the kept one, propagated like any stop edit.
 */
async function repointStops(
  tx: DbTransaction,
  userId: string,
  match: Prisma.TripStopWhereInput,
  data: { lodgingStayId: string } | { sourceId: string }
): Promise<void> {
  const stops = await tx.tripStop.findMany({
    where: { ...match, OR: [{ trip: { userId } }, { route: { userId } }] },
    select: { id: true },
  });
  if (stops.length === 0) return;
  const ids = stops.map((s) => s.id);
  const before = await shareSnapshots(tx, "stop", ids);
  await tx.tripStop.updateMany({ where: { id: { in: ids } }, data });
  await propagateWrites(tx, userId, "stop", ids, before);
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
  // A flight holds one recording. Two copies with one each would lose one.
  if (rows.filter((r) => r.track).length > 1) {
    throw new FindingActionError("invalidAction", "conflictingRecordings");
  }
  assertOneLink(rows, ["tripId", "bookingId"]);

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
  if (withTrack) {
    await tx.flightTrack.update({ where: { flightId: withTrack.id }, data: { flightId: keptId } });
  }

  const tripId = kept.tripId ?? removed.find((r) => r.tripId)?.tripId ?? null;
  const bookingId = kept.bookingId ?? removed.find((r) => r.bookingId)?.bookingId ?? null;
  if (tripId !== kept.tripId || bookingId !== kept.bookingId) {
    const before = await shareSnapshot(tx, "flight", keptId);
    await tx.flight.update({ where: { id: keptId }, data: { tripId, bookingId } });
    await propagateWrite(tx, userId, "flight", keptId, before);
  }
  // A timeline stop that wraps a removed copy wraps the kept one now.
  await repointStops(tx, userId, { sourceId: { in: [...removedIds] } }, { sourceId: keptId });

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
  assertOneLink(rows, ["tripId", "bookingId", "membershipId"]);

  await tx.document.updateMany({
    where: { userId, lodgingStayId: { in: [...removedIds] } },
    data: { lodgingStayId: keptId },
  });
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

  // AFTER the kept stay is on the (possibly shared) trip: a station's copy in
  // a member's account resolves its stay by the stay's share key, which the
  // kept copy only has once it has joined the trip.
  await repointStops(
    tx,
    userId,
    { lodgingStayId: { in: [...removedIds] } },
    {
      lodgingStayId: keptId,
    }
  );
  await repointStops(tx, userId, { sourceId: { in: [...removedIds] } }, { sourceId: keptId });

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
      // Validate HERE, on locked rows, in the transaction that deletes: a
      // check outside it could pass, then an edit turn a copy into a real,
      // different entry that the delete below would take with it.
      const ids = [keptId, ...removedIds];
      await lockCopies(tx, entityType, userId, ids);
      await assertStillDuplicates(userId, entityType, ids);
      if (entityType === "flight") await mergeFlights(tx, userId, keptId, removedIds);
      else if (entityType === "lodging_stay") await mergeStays(tx, userId, keptId, removedIds);
      else throw new FindingActionError("invalidAction", "notOffered");
      await alsoInTx(tx);
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  await recheckAchievements(userId, `merge ${entityType}`);
}
