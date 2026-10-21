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
import { isHeld, isReceiving } from "./peerMember";
import { ON_TRIP, mayReach, userRef } from "./roster";
import logger from "../../../utils/logger";
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
export async function queueEntries(
  tx: DbTransaction,
  memberId: string,
  options: { resync?: boolean } = {}
): Promise<number> {
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
  const authors = await entryAuthors(tx, member, entries, options.resync === true);
  for (const chunk of chunks) {
    const named = chunk.flatMap((e) => {
      const ref = authors.get(e.shareKey);
      return ref ? [{ shareKey: e.shareKey, ref }] : [];
    });
    await tx.tripShareOutbox.create({
      data: {
        groupId: group.id,
        memberId: member.id,
        peerOrigin: remote.origin,
        kind: "entries",
        payload: {
          from: remote.localChannel,
          entries: chunk,
          authors: named,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
  // An entry too large for any message is a stated loss, not a silent one.
  await tx.tripShareRemoteMember.update({
    where: { id: member.id },
    data: { stateReason: oversize.length > 0 ? "entries-too-large" : null },
  });
  kickDelivery();
  return chunks.length;
}

/**
 * Who brought each entry in, by roster ref, for the spoke's gate (F-S4e review) — every entry the
 * home can vouch for is named, and the spoke copies an entry without a name for nobody.
 *
 * - The first delivery after an accept is the trip as offered: an entry with no record yet is the
 *   offering member's own (it was in their trip; the record starts here), and one by someone no
 *   longer on the trip is theirs too — accepting the offer was the yes to its contents.
 * - A resend after a restore names only what the record says: an entry without a record is named
 *   by nobody and copied for nobody.
 */
async function entryAuthors(
  tx: DbTransaction,
  member: { groupId: string; group: { federatedRef: string | null }; remote: { userId: string } },
  entries: readonly WireEntry[],
  resync: boolean
): Promise<Map<string, string>> {
  const ownRef = userRef(member.group.federatedRef as string, member.remote.userId);
  const recorded = new Map(
    (await tx.tripShareEntryAuthor.findMany({ where: { groupId: member.groupId } })).map((a) => [
      a.shareKey,
      a.authorRef,
    ])
  );
  if (resync) return recorded;
  const onTrip = new Set([
    ownRef,
    ...(
      await tx.tripShareRemoteMember.findMany({
        where: { groupId: member.groupId, state: { in: ON_TRIP } },
        select: { rosterRef: true },
      })
    ).map((m) => m.rosterRef),
    ...(
      await tx.trip.findMany({
        where: { shareGroupId: member.groupId },
        select: { userId: true },
      })
    ).map((t) => userRef(member.group.federatedRef as string, t.userId)),
  ]);
  const missing = entries.filter((e) => !recorded.has(e.shareKey));
  if (missing.length > 0)
    await tx.tripShareEntryAuthor.createMany({
      data: missing.map((e) => ({
        groupId: member.groupId,
        shareKey: e.shareKey,
        authorRef: ownRef,
      })),
      skipDuplicates: true,
    });
  return new Map(
    entries.map((e) => {
      const ref = recorded.get(e.shareKey);
      return [e.shareKey, ref && onTrip.has(ref) ? ref : ownRef];
    })
  );
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
    // The memberships are held to the commit, as for every other message (`addressed`): a hold or
    // an end committed meanwhile waits for these copies, or is what is read.
    await tx.$queryRaw`SELECT 1 FROM trip_share_remote_members m
      JOIN remote_share_accounts r ON r.id = m.remote_id
      WHERE m.group_id = ${group.id} AND r.origin = ${origin} AND r.channel = ${message.from}
      ORDER BY m.id FOR NO KEY UPDATE OF m`;
    // Every membership that takes messages — also one shown unreachable or switched off there,
    // which recovers by itself (F-S4e review): refused, its entries would be parked for good.
    const members = (
      await tx.tripShareRemoteMember.findMany({
        where: { groupId: group.id, remote: { origin, channel: message.from } },
        select: {
          state: true,
          stateReason: true,
          rosterRef: true,
          localRef: true,
          remote: { select: { userId: true } },
        },
      })
    ).filter(isReceiving);
    const recipients = (
      await Promise.all(
        members.map(async (m) => {
          const trip = await tx.trip.findFirst({
            where: { userId: m.remote.userId, shareGroupId: group.id },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
          return trip
            ? {
                userId: m.remote.userId,
                tripId: trip.id,
                pairingRef: m.rosterRef,
                ownRef: m.localRef,
              }
            : null;
        })
      )
    ).filter(
      (r): r is { userId: string; tripId: string; pairingRef: string; ownRef: string | null } =>
        r !== null
    );
    if (recipients.length === 0) {
      // Held here until its person confirms again (F-S4e): kept there and sent again, not lost.
      const held = await tx.tripShareRemoteMember.findMany({
        where: { groupId: group.id, state: "suspended", remote: { origin, channel: message.from } },
      });
      throw rejectWith(held.some(isHeld) ? "suspended" : "not-member");
    }
    const rows = await fromWireEntries(tx, message.entries as WireEntry[]);
    const authorOf = new Map(message.authors.map((a) => [a.shareKey, a.ref]));
    for (const recipient of recipients) {
      // Fails closed (F-S4e review): an entry is copied only when the home names who brought it
      // in, and that is the home member of this pairing, the person here themselves, or someone
      // they said yes to. An entry named by nobody is copied for nobody.
      const allowed = new Set<string>();
      for (const { row } of rows) {
        const ref = authorOf.get(row.shareKey as string);
        const ok =
          !!ref &&
          (ref === recipient.pairingRef ||
            ref === recipient.ownRef ||
            (await mayReach(tx, group.id, recipient.userId, { pairingId: null, ref })));
        if (ok) allowed.add(row.shareKey as string);
      }
      if (allowed.size < rows.length)
        logger.info(
          { operation: "trip_share_entries_withheld", count: rows.length - allowed.size, origin },
          "Entries by someone the recipient has not said yes to were not copied"
        );
      for (const entity of SHARE_ENTITIES) {
        const ofType = rows.filter(
          (r) => r.entity === entity && allowed.has(r.row.shareKey as string)
        );
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
