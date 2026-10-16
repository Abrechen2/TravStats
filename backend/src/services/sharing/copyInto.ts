import type { DbTransaction } from "../../db";
import { ADAPTERS, type SharedRow } from "./adapters";
import { heldKeys, keyedDelegate, keyedIdsOnTrip } from "./keyOps";
import type { ShareEntity } from "./shareTypes";

/**
 * The one copy path (spec 2026-10-16, D3). Sharing a trip, propagating a new
 * entry and the ferry backfill all put an entry into another member's
 * account through here:
 *
 * 1. the recipient's own unkeyed row that IS this entry (`adapter.ownMatch`)
 *    takes the key — and is filed on their trip of the group when it had no
 *    trip; its private fields (their seat, their notes) stay as they are;
 * 2. otherwise the adapter creates a copy from the facts.
 *
 * Before the rework the share path joined own flights and propagation did
 * not, and each had its own house-reuse code.
 */
export interface Recipient {
  userId: string;
  tripId: string;
}

export async function copyInto(
  c: DbTransaction,
  entity: ShareEntity,
  source: SharedRow,
  recipient: Recipient
): Promise<{ id: string; joined: boolean }> {
  const adapter = ADAPTERS[entity];
  const own = adapter.ownMatch ? await adapter.ownMatch(c, source, recipient.userId) : null;
  if (own) {
    await keyedDelegate(c, entity).update({
      where: { id: own.id },
      data: { shareKey: source.shareKey, ...(own.tripId ? {} : { tripId: recipient.tripId }) },
    });
    return { id: own.id, joined: true };
  }
  const id = await adapter.createCopy(c, source, recipient.userId, recipient.tripId);
  return { id, joined: false };
}

export interface CopiedEntry {
  source: SharedRow;
  id: string;
  joined: boolean;
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
