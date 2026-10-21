/**
 * Catch-up across two servers (spec 2026-10-20, Q4–Q6 of 2026-10-21): Anna on A (the home)
 * shares a trip with one flight with Ben on B.
 *
 * - a restored spoke: confirming the trip again catches up both ways — what A sent after the dump
 *   comes back (`resync`), what Ben added while held goes up (`entries-up`), and a difference B
 *   cannot attribute is a conflict, never an overwrite;
 * - a confirmation nudges the other server, which delivers at once instead of at its backoff;
 *   a nudge is rate-limited per server and an unknown pairing changes nothing;
 * - a peer from rc.18 (no `features` in its ping) is sent none of the new messages: a resync is
 *   parked as `unsupported` and shown, a nudge is skipped, a confirmation still succeeds;
 * - a group message of a kind a server does not know is answered `unsupported`.
 */
import { randomUUID } from "crypto";
import { A, B, servers, useTwoServers, type Server } from "./twoServerHarness";
import {
  addFlight,
  editFlight,
  gateOf,
  membersOn,
  noticesOf,
  sharedFlight,
  MINUTE,
} from "./sharedTripFixtures";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const groupOn = async (s: Server, tripId: string) =>
  (await s.prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).shareGroupId as string;

/** B plays a server from rc.18: its ping names no features. */
const playOldServer = (s: Server) =>
  jest.spyOn(s.peerFeatures, "servedFeatures").mockReturnValue([]);

describe("a restored spoke catches up both ways (Q5)", () => {
  /**
   * B is restored from a dump taken before Anna's second flight and her gate change reached it,
   * then Ben adds a flight while the restore holds the trip.
   */
  async function restoredSpoke() {
    const t = await sharedFlight(a, b);
    const second = await addFlight(a, t.anna, t.trip.id);
    await a.propagate.propagateWrite(a.prisma, t.anna, "flight", second.id);
    await editFlight(a, t.anna, t.flight.id, { gate: "B2" });
    await a.outbox.runDeliveries();
    expect(await b.prisma.flight.count({ where: { tripId: t.benTrip } })).toBe(2);
    // What the dump does not have: the second flight and the new gate.
    const key = (await a.prisma.flight.findUniqueOrThrow({ where: { id: second.id } })).shareKey;
    await b.prisma.flight.deleteMany({ where: { tripId: t.benTrip, shareKey: key } });
    await b.prisma.flight.update({ where: { id: t.benFlight.id }, data: { gate: "A1" } });
    await b.restore.suspendTripFederationAfterRestore();
    const his = await addFlight(b, t.ben, t.benTrip);
    await b.prisma.flight.update({ where: { id: his.id }, data: { flightNumber: "LH1" } });
    await b.propagate.propagateWrite(b.prisma, t.ben, "flight", his.id);
    expect(await b.prisma.tripShareOutbox.count()).toBe(0);
    return { ...t, his };
  }

  it("confirming sends Ben's flight up and brings back what A sent after the dump", async () => {
    const t = await restoredSpoke();
    await b.lifecycle.reconfirmTrip(t.ben, t.benTrip);
    const kinds = (await b.prisma.tripShareOutbox.findMany({ orderBy: { position: "asc" } })).map(
      (r) => r.kind
    );
    expect(kinds).toEqual(["entries-up", "resync"]);
    expect(await b.outbox.runDeliveries()).toMatchObject({ sent: 2, parked: 0, failed: 0 });
    // Up: Ben's flight is in Anna's trip, named Ben.
    expect(await a.prisma.flight.count({ where: { tripId: t.trip.id, flightNumber: "LH1" } })).toBe(
      1
    );
    const [created] = await noticesOf(a, t.anna, "created");
    expect(created.remoteActor).toMatchObject({ displayName: "Ben", origin: B });

    expect(await a.outbox.runDeliveries()).toMatchObject({ parked: 0, failed: 0 });
    // Down: the second flight is back; the gate B cannot attribute is a conflict, not a write.
    expect(await b.prisma.flight.count({ where: { tripId: t.benTrip } })).toBe(3);
    expect(await gateOf(b, t.benFlight.id)).toBe("A1");
    const [conflict] = await noticesOf(b, t.ben, "conflict");
    expect(conflict.after).toMatchObject({ facts: { gate: "B2" } });
    expect(conflict.changes).toEqual([
      expect.objectContaining({ before: { kind: "text", value: "A1" } }),
    ]);
    // Ben's own flight came back to him unchanged and is not doubled.
    expect(await b.prisma.flight.count({ where: { tripId: t.benTrip, flightNumber: "LH1" } })).toBe(
      1
    );
  });

  it("a second catch-up changes nothing: no entry twice, no second conflict", async () => {
    const t = await restoredSpoke();
    await b.lifecycle.reconfirmTrip(t.ben, t.benTrip);
    await b.outbox.runDeliveries();
    await a.outbox.runDeliveries();
    const before = {
      atA: await a.prisma.flight.count({ where: { tripId: t.trip.id } }),
      atB: await b.prisma.flight.count({ where: { tripId: t.benTrip } }),
      noticesB: (await noticesOf(b, t.ben)).length,
      noticesA: (await noticesOf(a, t.anna)).length,
    };
    const groupId = await groupOn(b, t.benTrip);
    const member = await b.prisma.tripShareRemoteMember.findFirstOrThrow({
      where: { groupId, remote: { userId: t.ben } },
    });
    await b.prisma.$transaction(async (tx) => {
      await b.entriesUp.queueEntriesUp(tx, member.id);
      await b.resync.queueResync(tx, t.ben, groupId);
    });
    expect(await b.outbox.runDeliveries()).toMatchObject({ sent: 2 });
    await a.outbox.runDeliveries();
    expect({
      atA: await a.prisma.flight.count({ where: { tripId: t.trip.id } }),
      atB: await b.prisma.flight.count({ where: { tripId: t.benTrip } }),
      noticesB: (await noticesOf(b, t.ben)).length,
      noticesA: (await noticesOf(a, t.anna)).length,
    }).toEqual(before);
  });

  it("an entry the home knew and removed is not brought back by the push", async () => {
    const t = await restoredSpoke();
    await b.lifecycle.reconfirmTrip(t.ben, t.benTrip);
    await b.outbox.runDeliveries();
    // Anna deletes her copy of Ben's flight; a later push must not bring it back.
    const hers = await a.prisma.flight.findFirstOrThrow({
      where: { tripId: t.trip.id, flightNumber: "LH1" },
    });
    await a.prisma.flight.delete({ where: { id: hers.id } });
    const groupId = await groupOn(b, t.benTrip);
    const member = await b.prisma.tripShareRemoteMember.findFirstOrThrow({
      where: { groupId, remote: { userId: t.ben } },
    });
    await b.prisma.$transaction((tx) => b.entriesUp.queueEntriesUp(tx, member.id));
    await b.outbox.runDeliveries();
    expect(await a.prisma.flight.count({ where: { tripId: t.trip.id, flightNumber: "LH1" } })).toBe(
      0
    );
  });

  it("only the spoke's own entries go up, never a copy of someone else's", async () => {
    const t = await restoredSpoke();
    await b.lifecycle.reconfirmTrip(t.ben, t.benTrip);
    const [up] = await b.prisma.tripShareOutbox.findMany({ where: { kind: "entries-up" } });
    const keys = (up.payload as { entries: { shareKey: string }[] }).entries.map((e) => e.shareKey);
    const his = await b.prisma.flight.findUniqueOrThrow({ where: { id: t.his.id } });
    expect(keys).toEqual([his.shareKey]);
  });
});

describe("review of the catch-up (Codex, 2026-10-21)", () => {
  it("a resync from a member the home shows unreachable is answered, not swallowed (review 3)", async () => {
    const t = await sharedFlight(a, b);
    await b.prisma.flight.delete({ where: { id: t.benFlight.id } });
    await a.prisma.tripShareRemoteMember.updateMany({
      where: { groupId: t.groupId },
      data: { state: "unreachable", stateReason: "unreachable" },
    });
    const groupId = await groupOn(b, t.benTrip);
    await b.prisma.$transaction((tx) => b.resync.queueResync(tx, t.ben, groupId));
    await b.outbox.runDeliveries();
    await a.outbox.runDeliveries();
    expect(await b.prisma.flight.count({ where: { tripId: t.benTrip } })).toBe(1);
  });

  it("answering a resync of a switched-off member keeps its hold reason (security review)", async () => {
    const t = await sharedFlight(a, b);
    await a.prisma.flight.update({
      where: { id: t.flight.id },
      data: { specialData: { note: "x".repeat(1_100_000) } },
    });
    await a.prisma.tripShareRemoteMember.updateMany({
      where: { groupId: t.groupId },
      data: { state: "suspended", stateReason: "off" },
    });
    const groupId = await groupOn(b, t.benTrip);
    await b.prisma.$transaction((tx) => b.resync.queueResync(tx, t.ben, groupId));
    await b.outbox.runDeliveries();
    await a.outbox.runDeliveries();
    const [held] = await a.prisma.tripShareRemoteMember.findMany({ where: { groupId: t.groupId } });
    expect(held).toMatchObject({ state: "suspended", stateReason: "off" });
  });

  it("an own entry too large to send up is named on the trip page (review 4)", async () => {
    const t = await sharedFlight(a, b);
    await b.restore.suspendTripFederationAfterRestore();
    const his = await addFlight(b, t.ben, t.benTrip);
    await b.prisma.flight.update({
      where: { id: his.id },
      data: { specialData: { note: "x".repeat(1_100_000) } },
    });
    await b.propagate.propagateWrite(b.prisma, t.ben, "flight", his.id);
    await b.lifecycle.reconfirmTrip(t.ben, t.benTrip);
    expect((await membersOn(b, t.ben, t.benTrip))[0]).toMatchObject({
      stateReason: "entries-too-large",
    });
  });
});

describe("a confirmation nudges the other server (Q6)", () => {
  /** B holds the trip (a re-pinned key there): Anna's change is answered `suspended`. */
  async function heldOnB() {
    const t = await sharedFlight(a, b);
    await b.lifecycle.holdPeerMemberships(A, "repinned");
    await editFlight(a, t.anna, t.flight.id, { gate: "B2" });
    expect(await a.outbox.runDeliveries()).toMatchObject({ failed: 1 });
    return t;
  }

  it("Ben confirms: A delivers at once, not at its backoff", async () => {
    const t = await heldOnB();
    await b.lifecycle.reconfirmTrip(t.ben, t.benTrip);
    await b.nudge.settleNudges();
    // Due now — without the nudge it would wait a minute (then 5, 30, … up to a day).
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 1, failed: 0 });
    expect(await gateOf(b, t.benFlight.id)).toBe("B2");
  });

  it("without the nudge the same message waits for its backoff", async () => {
    const t = await heldOnB();
    jest.spyOn(b.peerFeatures, "peerSupports").mockResolvedValue(false);
    await b.lifecycle.reconfirmTrip(t.ben, t.benTrip);
    await b.nudge.settleNudges();
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 0 });
    expect(await a.outbox.runDeliveries(new Date(Date.now() + 2 * MINUTE))).toMatchObject({
      sent: 1,
    });
  });

  it("one nudge a minute per server is looked at; an unknown pairing changes nothing", async () => {
    const t = await heldOnB();
    const pairing = await b.prisma.remoteShareAccount.findFirstOrThrow({
      where: { userId: t.ben, origin: A },
    });
    const nudge = (from: string, to: string) => ({
      kind: "nudge" as const,
      messageId: randomUUID(),
      sentAt: new Date().toISOString(),
      from,
      to,
    });
    const row = () => a.prisma.tripShareOutbox.findFirstOrThrow({ where: { groupId: t.groupId } });
    const now = new Date();
    // Backed off far: only a nudge brings it forward within the next minutes.
    const waiting = new Date(now.getTime() + 86_400_000);
    await a.prisma.tripShareOutbox.update({
      where: { id: (await row()).id },
      data: { nextAttemptAt: waiting },
    });
    await expect(a.nudge.serveNudge(B, nudge(randomUUID(), randomUUID()), now)).resolves.toEqual({
      nudged: false,
    });
    // The unknown pairing used this minute's look: the real one waits for the next.
    await expect(
      a.nudge.serveNudge(B, nudge(pairing.localChannel, pairing.channel), now)
    ).resolves.toEqual({ nudged: false });
    expect((await row()).nextAttemptAt).toEqual(waiting);
    const later = new Date(now.getTime() + MINUTE);
    await expect(
      a.nudge.serveNudge(B, nudge(pairing.localChannel, pairing.channel), later)
    ).resolves.toEqual({ nudged: true });
    expect((await row()).nextAttemptAt).toEqual(later);
  });
});

describe("a peer from rc.18 (Q4–Q6 unknown there)", () => {
  it("a resync is not sent to it, but parked as `unsupported` and shown", async () => {
    const t = await sharedFlight(a, b);
    playOldServer(a);
    const groupId = await groupOn(b, t.benTrip);
    await b.prisma.$transaction((tx) => b.resync.queueResync(tx, t.ben, groupId));
    const before = await a.prisma.tripShareInbound.count({ where: { peerOrigin: B } });
    expect(await b.outbox.runDeliveries()).toMatchObject({ sent: 0, parked: 1, failed: 0 });
    expect(await a.prisma.tripShareInbound.count({ where: { peerOrigin: B } })).toBe(before);
    expect((await membersOn(b, t.ben, t.benTrip))[0].delivery).toMatchObject({
      state: "rejected",
      reason: "unsupported",
    });
    // The stream goes on: Ben's next change still reaches A.
    await editFlight(b, t.ben, t.benFlight.id, { gate: "C3" });
    expect(await b.outbox.runDeliveries()).toMatchObject({ sent: 1 });
    expect(await gateOf(a, t.flight.id)).toBe("C3");
  });

  it("a confirmation still succeeds and nudges nobody", async () => {
    const t = await sharedFlight(a, b);
    playOldServer(a);
    await b.lifecycle.holdPeerMemberships(A, "repinned");
    const before = await a.prisma.tripShareInbound.count({ where: { peerOrigin: B } });
    await expect(b.lifecycle.reconfirmTrip(t.ben, t.benTrip)).resolves.toBe(1);
    await b.nudge.settleNudges();
    expect(await a.prisma.tripShareInbound.count({ where: { peerOrigin: B } })).toBe(before);
  });

  it("a group message of a kind a server does not know is answered `unsupported`", async () => {
    const t = await sharedFlight(a, b);
    const pairing = await b.prisma.remoteShareAccount.findFirstOrThrow({
      where: { userId: t.ben, origin: A },
    });
    const group = await b.prisma.tripShareGroup.findUniqueOrThrow({
      where: { id: await groupOn(b, t.benTrip) },
    });
    const answer = await b.streams
      .sendOnStream(
        group.id,
        A,
        (seq) =>
          ({
            kind: "from-the-future",
            messageId: randomUUID(),
            sentAt: new Date().toISOString(),
            groupRef: group.federatedRef,
            seq,
            from: pairing.localChannel,
            to: pairing.channel,
          }) as never,
        b.transport.PROPAGATION_TRANSPORT
      )
      .then(
        () => "accepted",
        (e: { ack?: { rejected?: string } }) => e.ack?.rejected ?? String(e)
      );
    expect(answer).toBe("unsupported");
  });
});
