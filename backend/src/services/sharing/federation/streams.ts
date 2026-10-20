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
 * a resend at the seq the peer expects. F-S4d replaces the direct send with an outbox; this keeps
 * the numbering it will inherit.
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
 * are committed — where a reply must be followed by sending (F-S4c: entries after an accept).
 */
export async function serveOnce(
  origin: string,
  message: GroupMessage,
  apply: (tx: DbTransaction) => Promise<{ after?: () => void } | void>
): Promise<TripShareAck> {
  const repeat = await stored(origin, message.messageId);
  if (repeat) return repeat;
  const ack: TripShareAck = { kind: "ack", received: message.seq };
  let after: (() => void) | undefined;
  try {
    await prisma.$transaction(
      async (tx) => {
        after = (await apply(tx))?.after;
        await tx.tripShareInbound.create({
          data: {
            peerOrigin: origin,
            messageId: message.messageId,
            groupRef: message.groupRef,
            reply: ack,
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
 * seq, with a fresh message id each time it is called. Resolves with the seq that was
 * acknowledged; throws `StreamRejected` for a refusal, or the transport's error.
 */
export function sendOnStream(
  groupId: string,
  origin: string,
  build: (seq: number) => GroupMessage,
  transport: PeerTransport
): Promise<number> {
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
        if (ack.received !== seq) throw refused("malformed");
        await prisma.tripSharePeerStream.update({
          where: { groupId_peerOrigin: { groupId, peerOrigin: origin } },
          data: { lastSentSeq: seq },
        });
        return seq;
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
