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
 * F-S4c sends directly; a failure is recorded on the member (`stateReason`) and shown on the
 * trip page. F-S4d replaces the direct send with the outbox and its retries.
 */
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
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
import { fromWireEntries } from "./wire/decode";
import { toWireEntries } from "./wire/encode";
import type { WireEntry } from "./wire/shapes";
import { StreamRejected, rejectWith, sendOnStream, serveOnce, takeSeq } from "./streams";
import { BODY_BUDGET, ENTRIES_TRANSPORT, messageHeader } from "./transport";

/** Room left in a message for its header and the envelope's quoting of the body. */
const ENTRIES_BYTES = BODY_BUDGET.entries - 8_192;

const inFlight = new Set<Promise<void>>();

/** Keep a background delivery observable: its failures are logged and recorded, never thrown. */
export function trackDelivery(delivery: Promise<void>): void {
  const settled = delivery.catch((err: unknown) =>
    logger.error({ operation: "trip_share_delivery_failed", err }, "Trip-share delivery failed")
  );
  inFlight.add(settled);
  void settled.finally(() => inFlight.delete(settled));
}

/** Resolves once every delivery started so far has settled (tests, and a graceful shutdown). */
export async function settleDeliveries(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}

/** Wire entries into messages: at most fifty each, and within the body budget. */
export function chunkEntries(entries: readonly WireEntry[]): WireEntry[][] {
  const chunks: WireEntry[][] = [];
  let current: WireEntry[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const size = JSON.stringify(entry).length;
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

async function recordDelivery(memberId: string, stateReason: string | null): Promise<void> {
  await prisma.tripShareRemoteMember.update({ where: { id: memberId }, data: { stateReason } });
}

/** Every keyed entry of the member's trip, in registry order, on the wire. */
async function wireEntriesOf(userId: string, tripId: string): Promise<WireEntry[]> {
  return prisma.$transaction(
    async (tx) => {
      await assignShareKeys(tx, userId, tripId);
      const out: WireEntry[] = [];
      for (const entity of SHARE_ENTITIES) {
        const rows = await ADAPTERS[entity].load(
          tx,
          await keyedIdsOnTrip(tx, entity, userId, tripId)
        );
        out.push(
          ...(await toWireEntries(
            tx,
            entity,
            rows.filter((r) => !r.excluded)
          ))
        );
      }
      return out;
    },
    { timeout: 60_000 }
  );
}

/** Send the offering member's entries to the person behind remote member `memberId`. */
export async function deliverEntries(memberId: string): Promise<void> {
  const member = await prisma.tripShareRemoteMember.findUnique({
    where: { id: memberId },
    include: { remote: true, group: true },
  });
  if (!member?.group.federatedRef || member.state !== "active") return;
  const { remote, group } = member;
  const receiving = await receivingRemotes(prisma, group.id, remote.userId);
  if (!receiving.some((r) => r.id === member.id)) return;
  const trip = await prisma.trip.findFirst({
    where: { shareGroupId: group.id, userId: remote.userId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!trip) return;
  const entries = await wireEntriesOf(remote.userId, trip.id);
  const oversize = entries.filter((e) => JSON.stringify(e).length > ENTRIES_BYTES);
  try {
    for (const chunk of chunkEntries(entries.filter((e) => !oversize.includes(e)))) {
      await sendOnStream(
        group.id,
        remote.origin,
        (seq) => ({
          kind: "entries",
          ...messageHeader(),
          groupRef: group.federatedRef as string,
          seq,
          from: remote.localChannel,
          entries: chunk,
        }),
        ENTRIES_TRANSPORT
      );
    }
  } catch (error) {
    const reason = error instanceof StreamRejected ? "entries-refused" : "entries-undelivered";
    logger.warn(
      { operation: "trip_share_entries_failed", memberId, origin: remote.origin, kind: reason },
      "Entries did not reach the other server"
    );
    await recordDelivery(member.id, reason);
    return;
  }
  // An entry too large for any message is a stated loss, not a silent one.
  await recordDelivery(member.id, oversize.length > 0 ? "entries-too-large" : null);
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
