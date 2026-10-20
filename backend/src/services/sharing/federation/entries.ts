/**
 * The entries of an accepted trip, both sides (spec 2026-10-20 §4 `entries`, §5 "copyInto").
 *
 * Home: once the person accepted, the offering member's keyed entries are loaded through the
 * adapters (`SharedRow` — the fact lists and nothing else), turned into wire entries
 * (`wire/encode.ts`) and sent in registry order — stops last, they wrap the others — at most
 * fifty and 1 MB per message. Whether the person still receives is asked again right before
 * (`receivingRemotes`): an answer is a reference to a permission that must still hold.
 *
 * Receiving server: each entry is resolved against this server's catalogue (`wire/decode.ts`)
 * and copied into the trip of the person here who is paired with that member (`from`, the
 * pairing's channel) and accepted, through the one copy path (`copyInto`): their own matching flight is joined instead of duplicated, a key they
 * already hold is skipped (a repeat copies nothing twice), and each copy's status is derived on
 * this server's clock.
 *
 * Since F-S4d the entries leave through the outbox: they are queued in the same transaction that
 * makes the person a member (`serveOfferAnswer`), and the delivery scheduler sends them in order,
 * retrying while the other server does not answer (`outbox.ts`). A single entry too large for
 * any message is a stated loss, recorded on the member (`entries-too-large`).
 */
import { prisma, type DbTransaction } from "../../../db";
import type { Prisma } from "../../../prisma";
import { ADAPTERS } from "../adapters";
import { copyInto } from "../copyInto";
import { assignShareKeys, heldKeys, keyedIdsOnTrip } from "../keyOps";
import { receivingRemotes } from "../members";
import { SHARE_ENTITIES, type ShareEntity } from "../shareTypes";
import { restatusTrips } from "../../trip/restatusTrips";
import {
  MAX_ENTRIES_PER_MESSAGE,
  type EntriesMessage,
  type TripShareAck,
} from "../../../schemas/tripSharePeer";
import { kickDelivery } from "./deliveryKick";
import { runDeliveries } from "./outbox";
import { fromWireEntries } from "./wire/decode";
import { toWireEntries } from "./wire/encode";
import type { WireEntry } from "./wire/shapes";
import { rejectWith, serveOnce, takeSeq } from "./streams";
import { BODY_BUDGET, wireBytes } from "./transport";

/** Room left in a message for its header and the envelope's quoting of the body. */
const ENTRIES_BYTES = BODY_BUDGET.entries - 8_192;

/**
 * Deliver everything due now (tests, and a graceful shutdown). Before F-S4d this awaited the
 * direct background sends; the outbox made those a delivery pass.
 */
export async function settleDeliveries(): Promise<void> {
  await runDeliveries();
}

/** Wire entries into messages: at most fifty each, and within the body budget in wire bytes. */
export function chunkEntries(entries: readonly WireEntry[]): WireEntry[][] {
  const chunks: WireEntry[][] = [];
  let current: WireEntry[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const size = wireBytes(entry);
    if (
      current.length > 0 &&
      (current.length >= MAX_ENTRIES_PER_MESSAGE || bytes + size > ENTRIES_BYTES)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Every keyed entry of the member's trip, in registry order, on the wire. */
async function wireEntriesOf(tx: DbTransaction, userId: string, tripId: string) {
  await assignShareKeys(tx, userId, tripId);
  const out: WireEntry[] = [];
  for (const entity of SHARE_ENTITIES) {
    const rows = await ADAPTERS[entity].load(tx, await keyedIdsOnTrip(tx, entity, userId, tripId));
    out.push(
      ...(await toWireEntries(
        tx,
        entity,
        rows.filter((r) => !r.excluded)
      ))
    );
  }
  return out;
}

/**
 * Queue the offering member's entries for the person behind remote member `memberId`, inside the
 * caller's transaction. Asks again whether the person still receives (`receivingRemotes`). A
 * repeat queues everything again; the receiver keeps only what it lacks (`heldKeys`).
 */
export async function queueEntries(tx: DbTransaction, memberId: string): Promise<number> {
  const member = await tx.tripShareRemoteMember.findUnique({
    where: { id: memberId },
    include: { remote: true, group: true },
  });
  if (!member?.group.federatedRef || member.state !== "active") return 0;
  const { remote, group } = member;
  const receiving = await receivingRemotes(tx, group.id, remote.userId);
  if (!receiving.some((r) => r.id === member.id)) return 0;
  const trip = await tx.trip.findFirst({
    where: { shareGroupId: group.id, userId: remote.userId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!trip) return 0;
  const entries = await wireEntriesOf(tx, remote.userId, trip.id);
  const oversize = entries.filter((e) => wireBytes(e) > ENTRIES_BYTES);
  const chunks = chunkEntries(entries.filter((e) => !oversize.includes(e)));
  for (const chunk of chunks)
    await tx.tripShareOutbox.create({
      data: {
        groupId: group.id,
        memberId: member.id,
        peerOrigin: remote.origin,
        kind: "entries",
        payload: { from: remote.localChannel, entries: chunk } as unknown as Prisma.InputJsonValue,
      },
    });
  // An entry too large for any message is a stated loss, not a silent one.
  await tx.tripShareRemoteMember.update({
    where: { id: member.id },
    data: { stateReason: oversize.length > 0 ? "entries-too-large" : null },
  });
  kickDelivery();
  return chunks.length;
}

/** Queue the entries again for remote member `memberId` (its own transaction). */
export async function deliverEntries(memberId: string): Promise<void> {
  await prisma.$transaction((tx) => queueEntries(tx, memberId), { timeout: 60_000 });
}

/**
 * Entries arrive for a group whose home is `origin`. The stream's seq is taken first: it holds
 * the row lock an answer being undone on this server waits for (`offerInbox.ts`), so an accept
 * that is rolled back and entries for it never interleave.
 */
export function serveEntries(origin: string, message: EntriesMessage): Promise<TripShareAck> {
  return serveOnce(origin, message, async (tx) => {
    const group = await tx.tripShareGroup.findFirst({
      where: { homeOrigin: origin, federatedRef: message.groupRef },
    });
    if (!group) throw rejectWith("not-member");
    await takeSeq(tx, group.id, origin, message.seq);
    const members = await tx.tripShareRemoteMember.findMany({
      where: { groupId: group.id, state: "active", remote: { origin, channel: message.from } },
      select: { remote: { select: { userId: true } } },
    });
    const recipients = (
      await Promise.all(
        members.map(async (m) => {
          const trip = await tx.trip.findFirst({
            where: { userId: m.remote.userId, shareGroupId: group.id },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
          return trip ? { userId: m.remote.userId, tripId: trip.id } : null;
        })
      )
    ).filter((r): r is { userId: string; tripId: string } => r !== null);
    if (recipients.length === 0) throw rejectWith("not-member");
    const rows = await fromWireEntries(tx, message.entries as WireEntry[]);
    for (const recipient of recipients) {
      for (const entity of SHARE_ENTITIES) {
        const ofType = rows.filter((r) => r.entity === entity);
        if (ofType.length === 0) continue;
        const held = await heldKeys(
          tx,
          entity as ShareEntity,
          recipient.userId,
          recipient.tripId,
          ofType.map((r) => r.row.shareKey as string)
        );
        for (const { row } of ofType)
          if (!held.has(row.shareKey as string)) await copyInto(tx, entity, row, recipient);
      }
      await restatusTrips([recipient.tripId], tx);
    }
  });
}
