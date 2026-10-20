/**
 * Order, idempotency and size of group messages (spec 2026-10-20 §4, F-S4c): a repeated message
 * id answers what it was answered the first time and applies nothing twice; only the next seq of
 * a stream is accepted, and a gap writes nothing; an `entries` message holds at most fifty
 * entries and stays inside its byte budget.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../../db";
import type { OfferAnswer } from "../../../../schemas/tripSharePeer";
import { chunkEntries } from "../entries";
import { serveOnce, takeSeq } from "../streams";
import { BODY_BUDGET } from "../transport";
import type { WireEntry } from "../wire/shapes";

const ORIGIN = "https://peer.streams.test";
let groupId: string;
let groupRef: string;

beforeAll(async () => {
  groupRef = randomUUID();
  groupId = (
    await prisma.tripShareGroup.create({ data: { homeOrigin: ORIGIN, federatedRef: groupRef } })
  ).id;
});
afterAll(async () => {
  await prisma.tripShareGroup.delete({ where: { id: groupId } });
  await prisma.tripShareInbound.deleteMany({ where: { peerOrigin: ORIGIN } });
  await prisma.$disconnect();
});

const message = (seq: number, messageId = randomUUID()): OfferAnswer => ({
  kind: "offer-answer",
  messageId,
  sentAt: new Date().toISOString(),
  groupRef,
  seq,
  from: randomUUID(),
  to: randomUUID(),
  answer: "decline",
});
const lastReceived = async () =>
  (
    await prisma.tripSharePeerStream.findUniqueOrThrow({
      where: { groupId_peerOrigin: { groupId, peerOrigin: ORIGIN } },
    })
  ).lastReceivedSeq;

describe("serving a group message", () => {
  it("applies a message once; its repeat answers the first answer and writes nothing", async () => {
    const apply = jest.fn((tx: Parameters<Parameters<typeof serveOnce>[2]>[0]) =>
      takeSeq(tx, groupId, ORIGIN, 1)
    );
    const first = message(1);
    expect(await serveOnce(ORIGIN, first, apply)).toEqual({ kind: "ack", received: 1 });
    expect(await serveOnce(ORIGIN, first, apply)).toEqual({ kind: "ack", received: 1 });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(await lastReceived()).toBe(1);
  });

  it("answers a gap with the seq it expects, and rolls back what the message wrote", async () => {
    const skipped = message(3);
    const reply = await serveOnce(ORIGIN, skipped, async (tx) => {
      await tx.tripShareGroup.update({
        where: { id: groupId },
        data: { homeOrigin: "https://x.test" },
      });
      await takeSeq(tx, groupId, ORIGIN, skipped.seq);
    });
    expect(reply).toEqual({ kind: "ack", rejected: "gap", expected: 2 });
    expect(
      (await prisma.tripShareGroup.findUniqueOrThrow({ where: { id: groupId } })).homeOrigin
    ).toBe(ORIGIN);
    expect(await lastReceived()).toBe(1);
    // A rejected message is not remembered: once the gap is filled, the same id is served.
    await serveOnce(ORIGIN, message(2), (tx) => takeSeq(tx, groupId, ORIGIN, 2));
    expect(await serveOnce(ORIGIN, skipped, (tx) => takeSeq(tx, groupId, ORIGIN, 3))).toEqual({
      kind: "ack",
      received: 3,
    });
  });

  it("refuses a seq it has already accepted under a new message id", async () => {
    const before = await lastReceived();
    expect(
      await serveOnce(ORIGIN, message(before), (tx) => takeSeq(tx, groupId, ORIGIN, before))
    ).toEqual({ kind: "ack", rejected: "gap", expected: before + 1 });
  });
});

describe("entries per message", () => {
  const entry = (bytes = 0): WireEntry => ({
    entity: "stop",
    shareKey: randomUUID(),
    facts: { title: "x".repeat(bytes) },
  });

  it("puts at most fifty entries into one message", () => {
    expect(chunkEntries(Array.from({ length: 120 }, () => entry())).map((c) => c.length)).toEqual([
      50, 50, 20,
    ]);
  });

  it("keeps every message inside the 1 MB entries budget", () => {
    const chunks = chunkEntries(Array.from({ length: 12 }, () => entry(300_000)));
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks)
      expect(JSON.stringify(chunk).length).toBeLessThan(BODY_BUDGET.entries);
  });
});
