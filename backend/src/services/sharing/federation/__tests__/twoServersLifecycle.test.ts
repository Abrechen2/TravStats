/**
 * How a trip shared across two servers ends, pauses and resumes (spec 2026-10-20 phase F-S4e),
 * over real TLS between the harness's servers: Anna on A (the home) shares a trip with a flight
 * with Ben on B.
 *
 * - leave, from either side: told to the other server, the copy stays, nothing follows after;
 * - revoke, from either side: queued messages deleted, told, the spoke's copy leaves its group,
 *   and no message crosses afterwards in either direction — a message sent anyway is refused;
 * - a re-pinned key (O9) and a restored clone hold the memberships: nothing is sent, a message
 *   that arrives is answered `suspended` and kept by its sender; confirming the trip again
 *   resumes it (after a restore with the trip's entries sent once more);
 * - a refused message can be dismissed; a spoke asks the home to add someone (`add-request`) and
 *   cannot share the trip on locally.
 */
import { randomUUID } from "crypto";
import {
  A,
  B,
  servers,
  setOffline,
  user as harnessUser,
  useTwoServers,
  type Server,
} from "./twoServerHarness";
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

const memberRow = (s: Server, origin: string, userId: string) =>
  s.prisma.tripShareRemoteMember.findFirstOrThrow({
    where: { remote: { userId, origin } },
    orderBy: { createdAt: "desc" },
  });

const outboxOf = (s: Server, groupId: string) =>
  s.prisma.tripShareOutbox.findMany({ where: { groupId }, orderBy: { position: "asc" } });

/**
 * B sends a change on the old stream anyway, as a server that ignores a revoke or a leave would:
 * signed, numbered, addressed to the pairing — and the answer A gives it.
 */
async function forgedChangeFromB(ben: string, federatedRef: string, shareKey: string) {
  const pairing = await b.prisma.remoteShareAccount.findFirstOrThrow({
    where: { userId: ben, origin: A },
  });
  const group = await b.prisma.tripShareGroup.findFirstOrThrow({
    where: { homeOrigin: A, federatedRef },
  });
  try {
    await b.streams.sendOnStream(
      group.id,
      A,
      (seq) => ({
        kind: "fact-update",
        messageId: randomUUID(),
        sentAt: new Date().toISOString(),
        groupRef: federatedRef,
        seq,
        from: pairing.localChannel,
        to: pairing.channel,
        actor: { displayName: "Ben" },
        entity: "flight",
        shareKey,
        changes: [{ field: "gate", before: "A1", after: "X9" }],
      }),
      b.transport.PROPAGATION_TRANSPORT
    );
    return "accepted";
  } catch (error) {
    return (error as { ack?: { rejected?: string } }).ack?.rejected ?? String(error);
  }
}

describe("leave", () => {
  it("Ben leaves on B: Anna is told, his copy stays, nothing follows in either direction", async () => {
    const { anna, ben, trip, groupId, flight, benTrip, benFlight } = await sharedFlight(a, b);
    await b.shareTrip.leaveGroup(ben, benTrip);
    expect(await memberRow(b, A, ben)).toMatchObject({ state: "left" });
    expect((await b.prisma.trip.findUniqueOrThrow({ where: { id: benTrip } })).shareGroupId).toBe(
      null
    );
    expect(await b.prisma.flight.count({ where: { id: benFlight.id } })).toBe(1);
    expect(await b.outbox.runDeliveries()).toMatchObject({ sent: 1 });

    expect((await membersOn(a, anna, trip.id))[0]).toMatchObject({ state: "left" });
    const [left] = await noticesOf(a, anna, "left");
    expect(left).toMatchObject({ remoteActor: { displayName: "Ben", origin: B } });

    await editFlight(a, anna, flight.id, { gate: "B2" });
    await editFlight(b, ben, benFlight.id, { gate: "C3" });
    expect(await a.prisma.tripShareOutbox.count({ where: { groupId } })).toBe(0);
    expect(await b.outbox.runDeliveries()).toMatchObject({ sent: 0 });
    expect(await gateOf(b, benFlight.id)).toBe("C3");
    expect(await gateOf(a, flight.id)).toBe("B2");
  });

  it("Anna leaves on A: Ben is told, keeps his copy, and gets nothing more", async () => {
    const { anna, ben, trip, flight, benTrip, benFlight } = await sharedFlight(a, b);
    await a.shareTrip.leaveGroup(anna, trip.id);
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 1 });
    expect(await memberRow(b, A, ben)).toMatchObject({ state: "left" });
    const [left] = await noticesOf(b, ben, "left");
    expect(left).toMatchObject({ entityKey: benTrip, remoteActor: { displayName: "Anna" } });
    await editFlight(b, ben, benFlight.id, { gate: "C3" });
    expect(await b.outbox.runDeliveries()).toMatchObject({ sent: 0 });
    expect(await gateOf(a, flight.id)).toBe("A1");
  });
});

describe("revoke: no message after it, in either direction", () => {
  it("Anna withdraws: her queued messages go, Ben's server detaches his copy, both stop", async () => {
    const { anna, ben, remote, trip, groupId, flight, benTrip, benFlight } = await sharedFlight(
      a,
      b
    );
    const federatedRef = (
      await a.prisma.tripShareGroup.findUniqueOrThrow({ where: { id: groupId } })
    ).federatedRef as string;
    setOffline(B, true);
    await editFlight(a, anna, flight.id, { gate: "B2" });
    await a.lifecycle.withdrawRemoteConsent(anna, remote.id);
    // The queued change is gone; only the revoke waits.
    expect((await outboxOf(a, groupId)).map((r) => r.kind)).toEqual(["revoke"]);
    expect((await membersOn(a, anna, trip.id))[0]).toMatchObject({ state: "revoked" });
    setOffline(B, false);
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 1, dropped: 0 });
    expect(await gateOf(b, benFlight.id)).toBe("A1");

    expect(await memberRow(b, A, ben)).toMatchObject({ state: "revoked" });
    expect((await b.prisma.trip.findUniqueOrThrow({ where: { id: benTrip } })).shareGroupId).toBe(
      null
    );
    expect(
      await b.prisma.shareConsent.count({
        where: { targetId: ben, remoteRequester: { origin: A }, status: "withdrawn" },
      })
    ).toBe(1);
    expect((await noticesOf(b, ben, "left"))[0]).toMatchObject({ after: { revoked: true } });

    await editFlight(a, anna, flight.id, { gate: "D4" });
    await editFlight(b, ben, benFlight.id, { gate: "E5" });
    expect(await a.prisma.tripShareOutbox.count({ where: { groupId } })).toBe(0);
    expect(await b.outbox.runDeliveries()).toMatchObject({ sent: 0 });
    // A server that sends anyway is refused, and nothing is written.
    const shareKey = (await a.prisma.flight.findUniqueOrThrow({ where: { id: flight.id } }))
      .shareKey as string;
    expect(await forgedChangeFromB(ben, federatedRef, shareKey)).toBe("not-member");
    expect(await gateOf(a, flight.id)).toBe("D4");
  });

  it("Ben withdraws on B: his copy leaves at once, Anna's server stops and drops its queue", async () => {
    const { anna, ben, trip, groupId, flight, benTrip, benFlight } = await sharedFlight(a, b);
    const pairingOnB = await b.prisma.remoteShareAccount.findFirstOrThrow({
      where: { userId: ben, origin: A },
    });
    await editFlight(a, anna, flight.id, { gate: "B2" });
    await b.lifecycle.withdrawRemoteConsent(ben, pairingOnB.id);
    expect((await b.prisma.trip.findUniqueOrThrow({ where: { id: benTrip } })).shareGroupId).toBe(
      null
    );
    // A's queued change is answered as from someone no longer on the trip: parked, not applied.
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 0, parked: 1 });
    expect(await gateOf(b, benFlight.id)).toBe("A1");
    expect(await b.outbox.runDeliveries()).toMatchObject({ sent: 1 });
    expect((await membersOn(a, anna, trip.id))[0]).toMatchObject({ state: "revoked" });
    expect(await a.prisma.tripShareOutbox.count({ where: { groupId } })).toBe(0);
    const [left] = await noticesOf(a, anna, "left");
    expect(left).toMatchObject({ after: { revoked: true }, remoteActor: { displayName: "Ben" } });

    await editFlight(a, anna, flight.id, { gate: "D4" });
    expect(await a.prisma.tripShareOutbox.count({ where: { groupId } })).toBe(0);
  });
});

describe("held until confirmed again (O9, restore)", () => {
  it("a re-pinned key: nothing is sent or taken; confirming resumes both directions", async () => {
    const { anna, ben, trip, groupId, flight, benFlight } = await sharedFlight(a, b);
    expect(await a.lifecycle.holdPeerMemberships(B, "repinned")).toBe(1);
    await editFlight(a, anna, flight.id, { gate: "B2" });
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 0, failed: 0 });
    expect((await outboxOf(a, groupId))[0]).toMatchObject({ kind: "fact-update", attempts: 0 });
    const view = await a.tripRemoteSharing.tripRemoteSharing(anna, trip.id);
    expect(view.reconfirmable).toBe(true);
    expect(view.members[0]).toMatchObject({ state: "suspended", stateReason: "repinned" });

    // Ben's change is kept by B and retried: A answers `suspended`, never applies it.
    await editFlight(b, ben, benFlight.id, { gate: "C3" });
    expect(await b.outbox.runDeliveries()).toMatchObject({ failed: 1, parked: 0 });
    const benTrip = benFlight.tripId as string;
    expect((await membersOn(b, ben, benTrip))[0].delivery).toMatchObject({
      state: "retrying",
      reason: "suspended-there",
    });
    expect(await gateOf(a, flight.id)).toBe("B2");

    await a.lifecycle.reconfirmTrip(anna, trip.id);
    expect((await membersOn(a, anna, trip.id))[0]).toMatchObject({ state: "active" });
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 1 });
    expect(await b.outbox.runDeliveries(new Date(Date.now() + 2 * MINUTE))).toMatchObject({
      sent: 1,
    });
    // Both changes crossed; each met the other's — a conflict on both sides, nothing swapped.
    expect(await gateOf(a, flight.id)).toBe("B2");
    expect(await gateOf(b, benFlight.id)).toBe("C3");
    expect(await noticesOf(a, anna, "conflict")).toHaveLength(1);
  });

  it("a restored clone sends nothing; confirming sends the trip's entries once more", async () => {
    const { anna, ben, trip, groupId, benTrip } = await sharedFlight(a, b);
    await a.restore.suspendTripFederationAfterRestore();
    const added = await addFlight(a, anna, trip.id);
    await a.propagate.propagateWrite(a.prisma, anna, "flight", added.id);
    expect(await a.prisma.tripShareOutbox.count({ where: { groupId } })).toBe(0);
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 0 });
    expect(await b.prisma.flight.count({ where: { tripId: benTrip } })).toBe(1);

    await a.lifecycle.reconfirmTrip(anna, trip.id);
    const [member] = await membersOn(a, anna, trip.id);
    expect(member).toMatchObject({ state: "active" });
    expect(await a.outbox.runDeliveries()).toMatchObject({ failed: 0, parked: 0 });
    // The flight added while held arrives with the resent entries; the first is not doubled.
    expect(await b.prisma.flight.count({ where: { tripId: benTrip } })).toBe(2);
    void ben;
  });

  it("confirming needs the server admitted again, and something to confirm", async () => {
    const { anna, trip } = await sharedFlight(a, b);
    await expect(a.lifecycle.reconfirmTrip(anna, trip.id)).rejects.toMatchObject({
      code: "SHARE_REMOTE_NOTHING_TO_CONFIRM",
    });
    await a.lifecycle.holdPeerMemberships(B, "peer-blocked");
    await a.prisma.comparisonPeer.update({ where: { origin: B }, data: { enabled: false } });
    await expect(a.lifecycle.reconfirmTrip(anna, trip.id)).rejects.toMatchObject({
      code: "SHARE_REMOTE_PEER_NOT_ADMITTED",
    });
  });
});

describe("a refused message can be dismissed", () => {
  it("drops it from the trip page and does not send it", async () => {
    const { anna, trip, groupId, flight } = await sharedFlight(a, b);
    await editFlight(a, anna, flight.id, { gate: "B2" });
    const row = await a.prisma.tripShareOutbox.findFirstOrThrow({ where: { groupId } });
    await a.prisma.tripShareOutbox.update({
      where: { id: row.id },
      data: { parkedAt: new Date(), parkedReason: "schema", lastError: "changes.0.field" },
    });
    const [member] = await membersOn(a, anna, trip.id);
    expect(member.delivery).toMatchObject({ state: "rejected", reason: "schema" });
    await a.lifecycle.dismissParked(anna, trip.id, member.id);
    expect((await membersOn(a, anna, trip.id))[0].delivery).toMatchObject({ state: "delivered" });
    expect(await a.prisma.tripShareOutbox.count({ where: { groupId } })).toBe(0);
  });
});

describe("a spoke asks the home; it does not share on itself", () => {
  it("Ben's request reaches Anna's inbox, naming the person and the trip", async () => {
    const { anna, ben, trip, benTrip } = await sharedFlight(a, b);
    await expect(
      b.addRequest.requestAddition(ben, benTrip, {
        displayName: "Bea",
        origin: B,
        note: "Sie fährt mit.",
      })
    ).resolves.toEqual({ requested: true, origin: A });
    const [request] = await noticesOf(a, anna, "add-request");
    expect(request).toMatchObject({
      entityKey: trip.id,
      remoteActor: { displayName: "Ben", origin: B },
      after: { person: { displayName: "Bea", origin: B }, note: "Sie fährt mit." },
    });
    // At the home there is nobody to ask: the trip is offered from here.
    await expect(
      a.addRequest.requestAddition(anna, trip.id, { displayName: "Bea" })
    ).rejects.toMatchObject({ code: "SHARE_REMOTE_IS_HOME" });
  });

  it("sharing the received trip on locally is refused, naming its home", async () => {
    const { ben, benTrip } = await sharedFlight(a, b);
    const bea = await harnessUser(b, "Bea");
    await b.prisma.shareConsent.create({
      data: { requesterId: ben, targetId: bea, status: "accepted" },
    });
    const companion = await b.prisma.companion.create({
      data: {
        userId: ben,
        canonicalName: "bea",
        displayName: "Bea",
        searchName: "bea",
        linkedUserId: bea,
      },
    });
    await expect(b.shareTrip.shareTrip(ben, benTrip, companion.id)).rejects.toMatchObject({
      code: "SHARE_REMOTE_NOT_HOME",
      extra: { origin: A },
    });
  });
});

describe("the roster at the home", () => {
  it("a person on another server reaches a member here only after her yes", async () => {
    const { anna, ben, groupId, flight, benFlight } = await sharedFlight(a, b);
    const dora = await harnessUser(a, "Dora");
    await a.prisma.shareConsent.create({
      data: { requesterId: anna, targetId: dora, status: "accepted" },
    });
    const doraTrip = await a.prisma.trip.create({
      data: { userId: dora, name: "Lissabon", shareGroupId: groupId },
    });
    const keyed = await a.prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    const doras = await addFlight(a, dora, doraTrip.id);
    await a.prisma.flight.update({ where: { id: doras.id }, data: { shareKey: keyed.shareKey } });

    await editFlight(b, ben, benFlight.id, { gate: "B2" });
    await b.outbox.runDeliveries();
    expect(await gateOf(a, flight.id)).toBe("B2");
    expect(await gateOf(a, doras.id)).toBe("A1");

    const [benOnRoster] = (await a.tripRemoteSharing.tripRemoteSharing(dora, doraTrip.id)).roster;
    await a.roster.decideRosterPerson(dora, doraTrip.id, benOnRoster.ref, "accepted");
    await editFlight(b, ben, benFlight.id, { gate: "B3" });
    await b.outbox.runDeliveries();
    expect(await gateOf(a, doras.id)).toBe("B3");
    await expect(
      a.roster.decideRosterPerson(dora, doraTrip.id, crypto.randomUUID(), "accepted")
    ).rejects.toMatchObject({ code: "SHARE_REMOTE_ROSTER_NOT_FOUND" });
  });
});
