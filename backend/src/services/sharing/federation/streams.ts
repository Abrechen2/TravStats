/**
 * Order and idempotency of group messages (spec 2026-10-20 §4), both directions.
 *
 * Receiving: a message id seen before answers the reply it got the first time
 * (`TripShareInbound`, pruned after 30 days); otherwise the message must carry exactly the next
 * seq of its (sending origin, group) stream, or it is answered `ack { rejected: "gap", expected }`
 * and nothing is written. The seq moves in the same transaction as the message's writes, so a
 * message is applied wholly or not at all — and a rejected one is not remembered, because what
 * it would be answered can change once the gap is filled.
 *
 * Sending: one message at a time per (group, peer) in this process, numbered from the stream's
 * `lastSentSeq`, which moves only once the peer acknowledged. A `gap` answer is followed once by
 * a resend at the seq the peer expects. Since F-S4d every propagation message and the entries of
 * an accepted trip leave through the outbox (`outbox.ts`), which sends through here; the offer and
 * its answer, a person's own click, still send directly — both share this numbering and lock.
 */
import { Prisma } from "../../../prisma";
import { prisma, type DbTransaction } from "../../../db";
import { exchange, type PeerTransport } from "../../federation/security";
import { refused } from "../../federation/refusal";
import {
  ackSchema,
  type AckRejection,
  type GroupMessage,
  type TripShareAck,
} from "../../../schemas/tripSharePeer";

/** Long enough for fifty entries copied into every accepting member's account. */
const SERVE_TX_TIMEOUT_MS = 60_000;
const INBOUND_KEEP_MS = 30 * 86_400_000;

type Rejected = Extract<TripShareAck, { rejected: AckRejection }>;
export type Received = Extract<TripShareAck, { received: number }>;
/** What applying a message may add to its answer (the facts a `fact-update` could not write). */
type AckExtra = Omit<Received, "kind" | "received">;

/** A group message this server will not apply, with the ack that says why. */
export class GroupRejection extends Error {
  constructor(readonly ack: Rejected) {
    super(`Group message rejected: ${ack.rejected}`);
  }
}

export const rejectWith = (
  rejected: AckRejection,
  extra: { expected?: number; field?: string } = {}
): GroupRejection => new GroupRejection({ kind: "ack", rejected, ...extra });

/** Accept `seq` as the next message of the stream from `origin`, or reject with the gap. */
export async function takeSeq(
  tx: DbTransaction,
  groupId: string,
  origin: string,
  seq: number
): Promise<void> {
  const where = { groupId_peerOrigin: { groupId, peerOrigin: origin } };
  await tx.tripSharePeerStream.upsert({
    where,
    create: { groupId, peerOrigin: origin },
    update: {},
  });
  const moved = await tx.tripSharePeerStream.updateMany({
    where: { groupId, peerOrigin: origin, lastReceivedSeq: seq - 1 },
    data: { lastReceivedSeq: seq },
  });
  if (moved.count === 1) return;
  const stream = await tx.tripSharePeerStream.findUniqueOrThrow({ where });
  throw rejectWith("gap", { expected: stream.lastReceivedSeq + 1 });
}

const stored = async (origin: string, messageId: string): Promise<TripShareAck | null> => {
  const row = await prisma.tripShareInbound.findUnique({
    where: { peerOrigin_messageId: { peerOrigin: origin, messageId } },
  });
  return row ? ackSchema.parse(row.reply) : null;
};

/**
 * Serve one group message: answer a repeat from the inbound table, otherwise run `apply` (which
 * must call `takeSeq` before it writes) and remember the answer. `after` runs once the writes
 * are committed (a delivery kick); `ack` adds to the answer, and is remembered with it.
 */
export async function serveOnce(
  origin: string,
  message: GroupMessage,
  apply: (tx: DbTransaction) => Promise<{ after?: () => void; ack?: AckExtra } | void>
): Promise<TripShareAck> {
  const repeat = await stored(origin, message.messageId);
  if (repeat) return repeat;
  let ack: TripShareAck = { kind: "ack", received: message.seq };
  let after: (() => void) | undefined;
  try {
    await prisma.$transaction(
      async (tx) => {
        const result = await apply(tx);
        after = result?.after;
        if (result?.ack) ack = { ...result.ack, kind: "ack", received: message.seq };
        await tx.tripShareInbound.create({
          data: {
            peerOrigin: origin,
            messageId: message.messageId,
            groupRef: message.groupRef,
            reply: ack as Prisma.InputJsonValue,
          },
        });
        await tx.tripShareInbound.deleteMany({
          where: { receivedAt: { lt: new Date(Date.now() - INBOUND_KEEP_MS) } },
        });
      },
      { timeout: SERVE_TX_TIMEOUT_MS }
    );
  } catch (error) {
    if (error instanceof GroupRejection) return error.ack;
    // The same message twice at once: the first one's answer is the answer.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const first = await stored(origin, message.messageId);
      if (first) return first;
    }
    throw error;
  }
  after?.();
  return ack;
}

/** The peer refused a group message, with its reason. */
export class StreamRejected extends Error {
  constructor(readonly ack: Rejected) {
    super(`Peer rejected the message: ${ack.rejected}`);
  }
}

const queues = new Map<string, Promise<unknown>>();

/** Runs `task` after every earlier task of the same key has settled. */
function serially<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

/**
 * Send one group message to `origin`, numbered on the stream. `build` makes the message for a
 * seq. Resolves with the acknowledgement; throws `StreamRejected` for a refusal, or the
 * transport's error.
 *
 * `onAck` runs in the SAME transaction that moves `lastSentSeq` (F-S4d review): the outbox
 * deletes its row there, so "the peer has it" and "it is no longer queued" commit together or
 * not at all. If they do not — a crash, a failing notice — the retry carries the same message id
 * and the peer answers from its memory with the seq it took the first time. An ack for an
 * EARLIER seq is therefore that repeat, not a malformed answer: the stream does not move again,
 * and `onAck` completes what was left undone.
 */
export function sendOnStream(
  groupId: string,
  origin: string,
  build: (seq: number) => GroupMessage,
  transport: PeerTransport,
  onAck?: (tx: DbTransaction, ack: Received) => Promise<void>
): Promise<Received> {
  return serially(`${groupId}|${origin}`, async () => {
    const stream = await prisma.tripSharePeerStream.upsert({
      where: { groupId_peerOrigin: { groupId, peerOrigin: origin } },
      create: { groupId, peerOrigin: origin },
      update: {},
    });
    let seq = stream.lastSentSeq + 1;
    for (let attempt = 0; ; attempt++) {
      const ack = ackSchema.parse(await exchange(origin, build(seq), transport));
      if ("received" in ack) {
        // A later seq than asked for is not an answer to this message.
        if (ack.received > seq) throw refused("malformed");
        await prisma.$transaction(async (tx) => {
          if (ack.received === seq)
            await tx.tripSharePeerStream.update({
              where: { groupId_peerOrigin: { groupId, peerOrigin: origin } },
              data: { lastSentSeq: seq },
            });
          await onAck?.(tx, ack);
        });
        return ack;
      }
      if (ack.rejected === "gap" && ack.expected !== undefined && attempt === 0) {
        seq = ack.expected;
        continue;
      }
      throw new StreamRejected(ack);
    }
  });
}

/** Record, outside any network call, that `seq` reached the peer (an offer sent in a reply). */
export async function markSent(
  tx: DbTransaction,
  groupId: string,
  origin: string
): Promise<number> {
  const stream = await tx.tripSharePeerStream.upsert({
    where: { groupId_peerOrigin: { groupId, peerOrigin: origin } },
    create: { groupId, peerOrigin: origin, lastSentSeq: 1 },
    update: { lastSentSeq: { increment: 1 } },
  });
  return stream.lastSentSeq;
}
