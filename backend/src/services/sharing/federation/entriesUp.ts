/**
 * A restored spoke sends up the entries its own person brought into the trip (spec 2026-10-20,
 * Q5 of 2026-10-21): `entries-up`, spoke → home, through the outbox.
 *
 * Why: a restore deletes the outbox and holds every membership until its person confirms again;
 * an entry the person added before the dump but after the last delivery, or while the membership
 * was held, never reached the home, and no ordinary change will ever carry it there.
 *
 * Spoke: only entries the spoke recorded as its own person's (`TripShareEntryAuthor`,
 * `local:<account>` — a spoke records only its own people), never a copy of someone else's entry.
 *
 * Home: taken exactly like an `entry-create` from that pairing — the pairing is the author
 * whatever the entry says, the membership and the consent are checked and the seq is taken — and
 * an entry is copied only if the home NEVER KNEW it: no copy held, and no record of who brought it
 * in. An entry the home knew and removed is not brought back; nothing held is overwritten.
 */
import type { DbTransaction } from "../../../db";
import type { Prisma } from "../../../prisma";
import logger from "../../../utils/logger";
import { asPropagation } from "../propagationGuard";
import type { EntriesUpMessage, TripShareAck } from "../../../schemas/tripSharePeer";
import { kickDelivery } from "./deliveryKick";
import { chunkEntries, ENTRIES_BYTES, wireEntriesOf } from "./entries";
import { LOCAL_AUTHOR } from "./entryAuthors";
import { applyEntryCreate, type Admitted } from "./inbound";
import { fromSpoke } from "./resync";
import { serveOnce } from "./streams";
import { wireBytes } from "./transport";
import type { WireEntry } from "./wire/shapes";

/** Spoke: queue the person's own entries of the member's group for the home. */
export async function queueEntriesUp(tx: DbTransaction, memberId: string): Promise<number> {
  const member = await tx.tripShareRemoteMember.findUnique({
    where: { id: memberId },
    include: { remote: true, group: true },
  });
  if (!member?.group.homeOrigin || !member.group.federatedRef) return 0;
  const { remote, group } = member;
  const trip = await tx.trip.findFirst({
    where: { shareGroupId: group.id, userId: remote.userId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!trip) return 0;
  const own = new Set(
    (
      await tx.tripShareEntryAuthor.findMany({
        where: { groupId: group.id, authorRef: `${LOCAL_AUTHOR}${remote.userId}` },
        select: { shareKey: true },
      })
    ).map((r) => r.shareKey)
  );
  if (own.size === 0) return 0;
  const entries = (await wireEntriesOf(tx, remote.userId, trip.id, { assign: false })).filter((e) =>
    own.has(e.shareKey)
  );
  const fits = entries.filter((e) => wireBytes(e) <= ENTRIES_BYTES);
  if (fits.length < entries.length)
    logger.warn(
      { operation: "trip_share_entries_up_too_large", count: entries.length - fits.length },
      "An own entry is too large for any message and is not sent up"
    );
  const chunks = chunkEntries(fits);
  for (const chunk of chunks)
    await tx.tripShareOutbox.create({
      data: {
        groupId: group.id,
        memberId: member.id,
        peerOrigin: remote.origin,
        kind: "entries-up",
        payload: {
          from: remote.localChannel,
          to: remote.channel,
          entries: chunk,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  if (chunks.length > 0) kickDelivery();
  return chunks.length;
}

/** Home: a spoke's own entries arrive after its restore. */
export const serveEntriesUp = (origin: string, message: EntriesUpMessage): Promise<TripShareAck> =>
  serveOnce(origin, message, async (tx) => {
    const { group, pairing, member, trip } = await fromSpoke(tx, origin, message);
    const s: Admitted = {
      groupId: group.id,
      recipient: trip,
      origin,
      author: {
        kind: "remote",
        pairingId: pairing.id,
        displayName: pairing.displayName,
        origin: pairing.origin,
        ref: member.rosterRef,
      },
    };
    await asPropagation(async () => {
      for (const entry of message.entries as WireEntry[]) {
        // Known here once (a record of who brought it in): removed since, not missed.
        const known = await tx.tripShareEntryAuthor.findUnique({
          where: { groupId_shareKey: { groupId: group.id, shareKey: entry.shareKey } },
        });
        if (known) continue;
        await applyEntryCreate(tx, s, entry);
      }
    });
    return { after: kickDelivery };
  });
