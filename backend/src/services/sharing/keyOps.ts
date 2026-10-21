import { randomUUID } from "crypto";
import { recordEntryAuthor } from "./federation/entryAuthors";

import type { DbTransaction } from "../../db";
import { SHARE_ENTITIES, SHARE_TYPES, type ShareDelegate, type ShareEntity } from "./shareTypes";

/**
 * Share keys, generically over the registry (spec 2026-10-16, D2): keying a
 * trip's entries on first share, clearing them on detach, finding a user's
 * shared rows for the bulk sync, and what a recipient already holds.
 *
 * A timeline stop has no user column — its trip's owner owns it — and only
 * timeline stops are keyed (roadtrip stations and route corrections are not
 * shared). That is the one special case, and it lives in `ownedOnTrip`.
 */
type Where = Record<string, unknown>;
interface KeyedRow {
  id: string;
  shareKey: string | null;
}

/**
 * The structural slice of a Prisma delegate the key operations use. The cast
 * in `delegateOf` is the price of one switch instead of eight copies: the
 * generated delegates share these shapes but not a common type.
 */
export interface KeyedDelegate {
  findMany(args: {
    where: Where;
    select: { id: true; shareKey: true };
    orderBy?: { id: "asc" };
  }): Promise<KeyedRow[]>;
  findFirst(args: { where: Where; select: { id: true } }): Promise<{ id: string } | null>;
  update(args: {
    where: { id: string };
    data: { shareKey?: string | null; tripId?: string };
  }): Promise<unknown>;
  updateMany(args: {
    where: Where;
    data: { shareKey?: null; tripId?: string };
  }): Promise<{ count: number }>;
}

export function delegateOf(c: DbTransaction, delegate: ShareDelegate): KeyedDelegate {
  switch (delegate) {
    case "flight":
      return c.flight as unknown as KeyedDelegate;
    case "lodgingStay":
      return c.lodgingStay as unknown as KeyedDelegate;
    case "cruise":
      return c.cruise as unknown as KeyedDelegate;
    case "railJourney":
      return c.railJourney as unknown as KeyedDelegate;
    case "busJourney":
      return c.busJourney as unknown as KeyedDelegate;
    case "ferryJourney":
      return c.ferryJourney as unknown as KeyedDelegate;
    case "rentalBooking":
      return c.rentalBooking as unknown as KeyedDelegate;
    case "tripStop":
      return c.tripStop as unknown as KeyedDelegate;
    default: {
      const unknownDelegate: never = delegate;
      throw new Error(`No delegate for ${String(unknownDelegate)}`);
    }
  }
}

export const keyedDelegate = (c: DbTransaction, entity: ShareEntity): KeyedDelegate =>
  delegateOf(c, SHARE_TYPES[entity].delegate);

/** Only timeline stops are keyed — roadtrip stations and route corrections are not shared. */
const TIMELINE_STOP = { routeId: null, viaPoint: false } as const;

/** The owner's rows of `entity` filed on `tripId` (every stop of the trip for `stop`). */
function ownedOnTrip(entity: ShareEntity, ownerId: string, tripId: string): Where {
  return entity === "stop" ? { tripId } : { tripId, userId: ownerId };
}

/** Every delegate a timeline stop may wrap (`sourceId` / `lodgingStayId`). */
export const REF_DELEGATES: readonly ShareDelegate[] = SHARE_ENTITIES.filter(
  (e) => e !== "stop"
).map((e) => SHARE_TYPES[e].delegate);

/** Key the unkeyed rows of one type on the owner's trip; one uuid per row. */
export async function assignKeysFor(
  c: DbTransaction,
  entity: ShareEntity,
  ownerId: string,
  tripId: string
): Promise<string[]> {
  const delegate = keyedDelegate(c, entity);
  const rows = await delegate.findMany({
    where: {
      ...ownedOnTrip(entity, ownerId, tripId),
      ...(entity === "stop" ? TIMELINE_STOP : {}),
      shareKey: null,
    },
    select: { id: true, shareKey: true },
  });
  const keys: string[] = [];
  for (const row of rows) {
    const shareKey = randomUUID();
    await delegate.update({ where: { id: row.id }, data: { shareKey } });
    keys.push(shareKey);
  }
  return keys;
}

/** Give every entry of the sharer's trip a key, if it has none yet (first share). */
export async function assignShareKeys(
  c: DbTransaction,
  ownerId: string,
  tripId: string
): Promise<void> {
  const keys: string[] = [];
  for (const entity of SHARE_ENTITIES)
    keys.push(...(await assignKeysFor(c, entity, ownerId, tripId)));
  // Keyed here, on the owner's own trip: provably theirs (a copy arrives keyed). Recorded for a
  // resend across servers (F-S4e review).
  const trip = await c.trip.findUnique({ where: { id: tripId }, select: { shareGroupId: true } });
  if (!trip?.shareGroupId) return;
  for (const shareKey of keys)
    await recordEntryAuthor(c, trip.shareGroupId, shareKey, { kind: "user", id: ownerId });
}

/** Detach: clear every key on the member's trip; the rows stay theirs. */
export async function clearTripKeys(
  c: DbTransaction,
  userId: string,
  tripId: string
): Promise<void> {
  for (const entity of SHARE_ENTITIES) {
    await keyedDelegate(c, entity).updateMany({
      where: { ...ownedOnTrip(entity, userId, tripId), shareKey: { not: null } },
      data: { shareKey: null },
    });
  }
}

/** The keyed rows of one type on the owner's trip, oldest id first. */
export async function keyedIdsOnTrip(
  c: DbTransaction,
  entity: ShareEntity,
  ownerId: string,
  tripId: string
): Promise<string[]> {
  const rows = await keyedDelegate(c, entity).findMany({
    where: {
      ...ownedOnTrip(entity, ownerId, tripId),
      ...(entity === "stop" ? TIMELINE_STOP : {}),
      shareKey: { not: null },
    },
    select: { id: true, shareKey: true },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => r.id);
}

/** Which of `keys` the recipient already holds: key → row id (on their trip, for stops). */
export async function heldKeys(
  c: DbTransaction,
  entity: ShareEntity,
  recipientId: string,
  recipientTripId: string,
  keys: readonly string[]
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const where =
    entity === "stop"
      ? { tripId: recipientTripId, shareKey: { in: [...keys] } }
      : { userId: recipientId, shareKey: { in: [...keys] } };
  const rows = await keyedDelegate(c, entity).findMany({
    where,
    select: { id: true, shareKey: true },
  });
  return new Map(rows.flatMap((r) => (r.shareKey ? [[r.shareKey, r.id] as const] : [])));
}

/** A user's rows of `entity` that are keyed or filed on one of their shared trips. */
export async function sharedIdsOf(
  c: DbTransaction,
  userId: string,
  entity: ShareEntity
): Promise<string[]> {
  const owned = entity === "stop" ? { trip: { userId } } : { userId };
  const rows = await keyedDelegate(c, entity).findMany({
    where: {
      ...owned,
      OR: [{ shareKey: { not: null } }, { trip: { shareGroupId: { not: null } } }],
    },
    select: { id: true, shareKey: true },
  });
  return rows.map((r) => r.id);
}

/** Ids of one type filed on any of `tripIds` — what a merge moves. */
export async function idsOnTrips(
  c: DbTransaction,
  entity: ShareEntity,
  tripIds: readonly string[]
): Promise<string[]> {
  const rows = await keyedDelegate(c, entity).findMany({
    where: { tripId: { in: [...tripIds] } },
    select: { id: true, shareKey: true },
  });
  return rows.map((r) => r.id);
}

/** `userId`'s row with `key` in one table (the `(userId, shareKey)` unique index). */
export async function findByUserKey(
  c: DbTransaction,
  delegate: ShareDelegate,
  userId: string,
  key: string
): Promise<{ id: string } | null> {
  if (delegate === "tripStop") return null;
  return delegateOf(c, delegate).findFirst({
    where: { userId, shareKey: key },
    select: { id: true },
  });
}
