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
 * 1. the recipient's own unkeyed row that IS this entry (`adapter.ownMatch`)
 *    takes the key and is filed on their trip of the group — moved there from
 *    another of their trips if need be (owner decision 2026-10-16: left where
 *    it was, no copy lookup found it, the shared trip never showed it and
 *    their next own edit cleared the key again). The trip it came from is
 *    returned, for the notice and its undo. Its private fields (their seat,
 *    their notes) stay as they are;
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

export async function copyInto(
  c: DbTransaction,
  entity: ShareEntity,
  source: SharedRow,
  recipient: Recipient
): Promise<CopyResult> {
  const adapter = ADAPTERS[entity];
  const own = adapter.ownMatch ? await adapter.ownMatch(c, source, recipient.userId) : null;
  if (own) {
    await keyedDelegate(c, entity).update({
      where: { id: own.id },
      data: { shareKey: source.shareKey, tripId: recipient.tripId },
    });
    if (!own.tripId || own.tripId === recipient.tripId) return { id: own.id, joined: true };
    const from = await c.trip.findUniqueOrThrow({
      where: { id: own.tripId },
      select: { id: true, name: true },
    });
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
    out.push({ source, ...(await copyInto(c, entity, source, recipient)) });
  }
  return out;
}
