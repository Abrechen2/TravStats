import type { DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { Prisma, Trip } from "../../prisma";
import { takeTravTrackLock } from "../travtrack/lock";
import { narrowShareSnapshots } from "../travtrack/shareNarrow";
import { restatusTrips } from "../trip/restatusTrips";
import { changedKeys, jsonSubset, revivedRecord, sameFact, type FactRecord } from "./factValues";
import { receivingMembers } from "./members";
import { asPropagation, isPropagating } from "./propagationGuard";

/**
 * A shared trip's PERIOD (owner, forgejo#280 point 4, 2026-10-27): the date
 * range syncs — it is a fact, the same for everyone on the trip — and the
 * name does not, because each member names their trip. Until then neither
 * did; only the entries synced.
 *
 * The period is one fact set, applied whole: moving only the end of a trip
 * whose member had another start would otherwise leave that member a trip
 * that ends before it begins. Values are copied as stored, with their zones
 * (ADR 0002) — never re-derived.
 *
 * It behaves like an entry's facts (design 2026-10-09, decision 3): every
 * member whose consent reaches the writer (`receivingMembers`) takes it at
 * once and gets an `updated` notice of entity type `trip`, keyed by their own
 * trip id, which they may undo. The undo is their change and reaches the
 * others the same way.
 *
 * Local members only: a period change does not travel to people on other
 * servers yet — the federation message vocabulary has no trip-level fact.
 */

export const TRIP_PERIOD_FIELDS = [
  "startDate",
  "endDate",
  "startDay",
  "endDay",
  "startZone",
  "endZone",
] as const satisfies readonly (keyof Trip)[];

export type TripPeriod = Pick<Trip, (typeof TRIP_PERIOD_FIELDS)[number]>;

export const TRIP_PERIOD_SELECT = {
  startDate: true,
  endDate: true,
  startDay: true,
  endDay: true,
  startZone: true,
  endZone: true,
} as const satisfies Record<(typeof TRIP_PERIOD_FIELDS)[number], true>;

const periodOf = (trip: TripPeriod): FactRecord =>
  Object.fromEntries(TRIP_PERIOD_FIELDS.map((f) => [f, trip[f]]));

/** The zone of each day, which the inbox shows a day in (`noticeChanges`). */
const zonesOf = (p: FactRecord): Prisma.InputJsonObject => ({
  startDay: (p.startZone as string | null) ?? null,
  endDay: (p.endZone as string | null) ?? null,
});

/** Write a period onto a member's trip, as their trip: lock, narrow their shared routes, restatus. */
async function writePeriod(
  tx: DbTransaction,
  trip: { id: string; userId: string },
  period: FactRecord
): Promise<void> {
  // A shared TravTrack route narrows to the trip's new days in the same
  // transaction, as on the member's own edit (`PATCH /trips/:id`).
  await takeTravTrackLock(tx, trip.userId);
  await tx.trip.update({
    where: { id: trip.id },
    data: period as Prisma.TripUncheckedUpdateInput,
  });
  await narrowShareSnapshots(tx, trip.userId, { tripId: trip.id });
  await restatusTrips([trip.id], tx);
}

/**
 * After `actorId` changed their trip `tripId` (`before` = its period before
 * the write): every receiving member's trip of its group takes the period.
 * Call inside the write's transaction. A write that left the period alone,
 * or a trip in no group, does nothing.
 */
export async function propagateTripPeriod(
  tx: DbTransaction,
  actorId: string,
  tripId: string,
  before: TripPeriod
): Promise<void> {
  if (isPropagating()) return;
  const trip = await tx.trip.findFirst({
    where: { id: tripId, userId: actorId },
    select: { id: true, shareGroupId: true, ...TRIP_PERIOD_SELECT },
  });
  if (!trip?.shareGroupId) return;
  const now = periodOf(trip);
  if (changedKeys(periodOf(before), now, TRIP_PERIOD_FIELDS).length === 0) return;
  const groupId = trip.shareGroupId;

  await asPropagation(async () => {
    for (const member of await receivingMembers(tx, groupId, actorId)) {
      const theirs = await tx.trip.findUniqueOrThrow({
        where: { id: member.id },
        select: { name: true, ...TRIP_PERIOD_SELECT },
      });
      const old = periodOf(theirs);
      const keys = changedKeys(old, now, TRIP_PERIOD_FIELDS);
      if (keys.length === 0) continue;
      await writePeriod(tx, member, now);
      await tx.shareNotice.create({
        data: {
          userId: member.userId,
          groupId,
          actorId,
          kind: "updated",
          entityType: "trip",
          // A trip notice is keyed by the recipient's own trip (`notices.ts`).
          entityKey: member.id,
          before: { facts: jsonSubset(old, keys), zones: zonesOf(old) },
          after: {
            label: theirs.name,
            tripId: member.id,
            entryId: member.id,
            facts: jsonSubset(now, keys),
            zones: zonesOf(now),
          },
        },
      });
    }
  });
}

/**
 * Undo a period notice on the caller's own trip: only while it still holds
 * exactly what the change wrote (else 409 `SHARE_UNDO_STALE`, naming the
 * fields). The restore is the caller's change and propagates like one.
 */
export async function undoTripPeriod(
  tx: DbTransaction,
  userId: string,
  notice: {
    entityKey: string | null;
    groupId: string | null;
    before: Prisma.JsonValue;
    after: Prisma.JsonValue;
  }
): Promise<{ tripId: string }> {
  const own = notice.entityKey
    ? await tx.trip.findFirst({
        where: { id: notice.entityKey, userId, shareGroupId: notice.groupId ?? undefined },
        select: { id: true, ...TRIP_PERIOD_SELECT },
      })
    : null;
  if (!own || !notice.groupId) {
    throw new AppError("Your trip is no longer in this group", 409, "SHARE_COPY_NOT_FOUND");
  }
  const after = revivedRecord(factsOf(notice.after));
  const restored = revivedRecord(factsOf(notice.before));
  const keys = Object.keys(after);
  if (keys.length === 0) {
    throw new AppError("This notice carries no values", 409, "SHARE_UNDO_UNAVAILABLE");
  }
  const current = periodOf(own);
  const changedSince = keys.filter((k) => !sameFact(current[k], after[k]));
  if (changedSince.length > 0) {
    throw new AppError(
      `Changed since this notice: ${changedSince.join(", ")}`,
      409,
      "SHARE_UNDO_STALE",
      undefined,
      { fields: changedSince.join(",") }
    );
  }
  const next = { ...current, ...pickKeys(restored, keys) };
  // A notice records only the fields it changed, so restoring them beside a
  // later edit of the other end can turn the period inside out. Refuse that
  // as stale instead of writing — and propagating — an impossible trip.
  const inverted = endsBeforeItBegins(next);
  if (inverted.length > 0) {
    throw new AppError(
      `Undo would end the trip before it begins: ${inverted.join(", ")}`,
      409,
      "SHARE_UNDO_STALE",
      undefined,
      { fields: inverted.join(",") }
    );
  }
  await writePeriod(tx, { id: own.id, userId }, next);
  await propagateTripPeriod(tx, userId, own.id, own);
  return { tripId: own.id };
}

const timeOf = (value: unknown): number | null => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
};

/** The start fields of each pair that would lie after its end. */
function endsBeforeItBegins(period: FactRecord): string[] {
  return (
    [
      ["startDay", "endDay"],
      ["startDate", "endDate"],
    ] as const
  ).flatMap(([from, to]) => {
    const a = timeOf(period[from]);
    const b = timeOf(period[to]);
    return a !== null && b !== null && a > b ? [from, to] : [];
  });
}

function factsOf(side: Prisma.JsonValue): Prisma.JsonValue | null {
  if (!side || typeof side !== "object" || Array.isArray(side)) return null;
  return (side as Prisma.JsonObject).facts ?? null;
}

const pickKeys = (record: FactRecord, keys: readonly string[]): FactRecord =>
  Object.fromEntries(keys.filter((k) => k in record).map((k) => [k, record[k]]));
