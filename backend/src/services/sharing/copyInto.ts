import type { DbTransaction } from "../../db";
import { ADAPTERS, type SharedRow } from "./adapters";
import { restatusTrips } from "../trip/restatusTrips";
import { DERIVE } from "./deriveCopy";
import { heldKeys, keyedDelegate, keyedIdsOnTrip } from "./keyOps";
import type { ShareEntity } from "./shareTypes";

/**
 * The one copy path (spec 2026-10-16, D3). Sharing a trip, propagating a new
 * entry and the ferry backfill all put an entry into another member's
 * account through here:
 *
 * 1. the recipient's own unkeyed row that IS this entry (`adapter.ownMatches`)
 *    takes the key and is filed on their trip of the group — moved there from
 *    another of their trips if need be (owner decision 2026-10-16: left where
 *    it was, no copy lookup found it, the shared trip never showed it and
 *    their next own edit cleared the key again). The trip it came from is
 *    returned, for the notice and its undo. Its private fields (their seat,
 *    their notes) stay as they are;
 *    An own entry on a trip of ANOTHER share group is never taken (that group
 *    would silently lose it); the first match that may be taken wins. When
 *    every match sits in another group, nothing is copied either (a
 *    duplicate): `null`, and the caller records nothing (controller ruling
 *    2026-10-16);
 * 2. otherwise the adapter creates a copy from the facts.
 *
 * Before the rework the share path joined own flights and propagation did
 * not, and each had its own house-reuse code.
 */
export interface Recipient {
  userId: string;
  tripId: string;
}

/** Where a joined own entry was filed before it was moved onto the group trip. */
export interface MovedFrom {
  tripId: string;
  tripName: string;
}

export interface CopyResult {
  id: string;
  joined: boolean;
  /** Set when the joined entry was moved here from another of the recipient's trips. */
  movedFrom?: MovedFrom;
}

interface OwnMatch {
  id: string;
  tripId: string | null;
}

/**
 * The first match that may be taken: unfiled, on the recipient's group trip,
 * or on a trip of theirs outside any share group (`from`, the trip it leaves).
 */
async function firstTakeable(
  c: DbTransaction,
  matches: readonly OwnMatch[],
  groupTripId: string
): Promise<{ own: OwnMatch; from: { id: string; name: string } | null } | null> {
  const elsewhere = [
    ...new Set(matches.flatMap((m) => (m.tripId && m.tripId !== groupTripId ? [m.tripId] : []))),
  ];
  const trips = new Map(
    (
      await c.trip.findMany({
        where: { id: { in: elsewhere } },
        select: { id: true, name: true, shareGroupId: true },
      })
    ).map((t) => [t.id, t])
  );
  for (const own of matches) {
    if (!own.tripId || own.tripId === groupTripId) return { own, from: null };
    const trip = trips.get(own.tripId);
    if (trip && !trip.shareGroupId) return { own, from: { id: trip.id, name: trip.name } };
  }
  return null;
}

export async function copyInto(
  c: DbTransaction,
  entity: ShareEntity,
  source: SharedRow,
  recipient: Recipient
): Promise<CopyResult | null> {
  const adapter = ADAPTERS[entity];
  const matches = adapter.ownMatches ? await adapter.ownMatches(c, source, recipient.userId) : [];
  if (matches.length > 0) {
    const pick = await firstTakeable(c, matches, recipient.tripId);
    if (!pick) return null;
    const { own, from } = pick;
    await keyedDelegate(c, entity).update({
      where: { id: own.id },
      data: { shareKey: source.shareKey, tripId: recipient.tripId },
    });
    if (!from) return { id: own.id, joined: true };
    // The trip it left loses an entry, so its span and status are re-derived too.
    await restatusTrips([from.id, recipient.tripId], c);
    return { id: own.id, joined: true, movedFrom: { tripId: from.id, tripName: from.name } };
  }
  const id = await adapter.createCopy(c, source, recipient.userId, recipient.tripId);
  await DERIVE[entity](c, id, recipient.userId);
  return { id, joined: false };
}

/** The notice fields that say the entry was joined, and moved from where. */
export const joinedMeta = (copy: CopyResult) => ({
  ...(copy.joined ? { joined: true } : {}),
  ...(copy.movedFrom ? { movedFrom: { ...copy.movedFrom } } : {}),
});

export interface CopiedEntry extends CopyResult {
  source: SharedRow;
}

/** The owner trip's keyed entries of one type that the recipient does not hold yet, copied. */
export async function copyMissing(
  c: DbTransaction,
  entity: ShareEntity,
  owner: Recipient,
  recipient: Recipient
): Promise<CopiedEntry[]> {
  const ids = await keyedIdsOnTrip(c, entity, owner.userId, owner.tripId);
  const sources = await ADAPTERS[entity].load(c, ids);
  const have = await heldKeys(
    c,
    entity,
    recipient.userId,
    recipient.tripId,
    sources.flatMap((s) => (s.shareKey ? [s.shareKey] : []))
  );
  const out: CopiedEntry[] = [];
  for (const source of sources) {
    if (!source.shareKey || have.has(source.shareKey)) continue;
    const copy = await copyInto(c, entity, source, recipient);
    if (copy) out.push({ source, ...copy });
  }
  return out;
}
