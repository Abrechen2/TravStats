/**
 * Changes cross two servers (spec 2026-10-20 phase F-S4d), end to end over real TLS between the
 * in-process servers of `twoServerHarness.ts`: Anna on A shares a trip with a flight with Ben on
 * B. Each test drives the outbox by hand (`runDeliveries`), moving its clock instead of waiting.
 *
 * What the user sees is asserted where they would see it: the notices in the inbox
 * (`listNotices`) and each remote member's state on the trip page (`tripRemoteSharing`).
 */
import {
  A,
  B,
  pin,
  servers,
  setOffline,
  setSwitch,
  user as harnessUser,
  useTwoServers,
  type Server,
} from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const MINUTE = 60_000;
const DAY = 86_400_000;

async function pair(anna: string, ben: string) {
  const { code } = await a.invites.createTripInvite(anna);
  await b.claim.claimTripInvite(ben, code);
  return a.prisma.remoteShareAccount.findFirstOrThrow({ where: { userId: anna, origin: B } });
}

/** Anna's trip with one flight at gate A1, offered to and accepted by Ben, entries delivered. */
async function sharedFlight() {
  const anna = await harnessUser(a, "Anna");
  const ben = await harnessUser(b, "Ben");
  const remote = await pair(anna, ben);
  const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
  const flight = await a.prisma.flight.create({
    data: {
      userId: anna,
      tripId: trip.id,
      flightNumber: "TP571",
      depIata: "FRA",
      arrIata: "LIS",
      depLat: 50.03,
      depLon: 8.57,
      arrLat: 38.77,
      arrLon: -9.13,
      departureTime: new Date("2030-06-01T08:00:00.000Z"),
      depTimezone: "Europe/Berlin",
      gate: "A1",
    },
  });
  await a.offers.offerTrip(anna, trip.id, remote.id);
  const [offer] = await b.offerInbox.listReceivedOffers(ben);
  const { tripId: benTrip } = await b.offerInbox.acceptOffer(ben, offer.id);
  await a.outbox.runDeliveries();
  const benFlight = await b.prisma.flight.findFirstOrThrow({ where: { tripId: benTrip } });
  const groupId = (await a.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } }))
    .shareGroupId as string;
  return { anna, ben, trip, groupId, flight, benTrip, benFlight };
}

/** A user's own edit of a flight, through the propagation every write path calls. */
async function editFlight(
  s: Server,
  userId: string,
  flightId: string,
  data: { gate?: string; terminal?: string }
) {
  await s.prisma.$transaction(async (tx) => {
    const before = await s.propagate.shareSnapshot(tx, "flight", flightId);
    await tx.flight.update({ where: { id: flightId }, data });
    await s.propagate.propagateWrite(tx, userId, "flight", flightId, before);
  });
}
const setGate = (s: Server, userId: string, flightId: string, gate: string) =>
  editFlight(s, userId, flightId, { gate });

const gateOf = async (s: Server, id: string) =>
  (await s.prisma.flight.findUniqueOrThrow({ where: { id } })).gate;

const noticesOf = (s: Server, userId: string, kind?: string) =>
  s.notices.listNotices(userId).then((all) => all.filter((n) => !kind || n.kind === kind));

/** The one remote member a trip page shows. */
async function memberOn(s: Server, userId: string, tripId: string) {
  const view = await s.tripRemoteSharing.tripRemoteSharing(userId, tripId);
  expect(view.members).toHaveLength(1);
  return view.members[0];
}

describe("a change made on one server reaches the other, named and undoable", () => {
  it("tells Ben when the trip arrives, naming Anna and her server", async () => {
    const { ben, benTrip } = await sharedFlight();
    const [shared] = await noticesOf(b, ben, "shared");
    expect(shared).toMatchObject({
      entityKey: benTrip,
      actor: null,
      remoteActor: { displayName: "Anna", origin: A },
    });
  });

  it("Anna's edit lands on Ben's copy; Ben's undo lands on Anna's; Anna's undo of that lands on Ben's", async () => {
    const { anna, ben, flight, benFlight, trip } = await sharedFlight();
    await setGate(a, anna, flight.id, "B2");
    expect(await memberOn(a, anna, trip.id)).toMatchObject({ delivery: { state: "pending" } });
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 1 });
    expect(await memberOn(a, anna, trip.id)).toMatchObject({ delivery: { state: "delivered" } });
    expect(await gateOf(b, benFlight.id)).toBe("B2");
    const [onB] = await noticesOf(b, ben, "updated");
    expect(onB).toMatchObject({
      remoteActor: { displayName: "Anna", origin: A },
      changes: [{ field: "gate", before: { value: "A1" }, after: { value: "B2" } }],
    });

    // Ben undoes it: an ordinary change by Ben that travels back.
    await b.undo.undoNotice(ben, onB.id);
    expect(await gateOf(b, benFlight.id)).toBe("A1");
    expect(await b.outbox.runDeliveries()).toMatchObject({ sent: 1 });
    expect(await gateOf(a, flight.id)).toBe("A1");
    const [onA] = await noticesOf(a, anna, "updated");
    expect(onA).toMatchObject({
      remoteActor: { displayName: "Ben", origin: B },
      changes: [{ field: "gate", before: { value: "B2" }, after: { value: "A1" } }],
    });

    // Anna undoes the undo.
    await a.undo.undoNotice(anna, onA.id);
    await a.outbox.runDeliveries();
    expect(await gateOf(a, flight.id)).toBe("B2");
    expect(await gateOf(b, benFlight.id)).toBe("B2");
    expect(await noticesOf(b, ben, "updated")).toHaveLength(2);
    // Nothing echoes: each server's outbox is empty once delivered.
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 0 });
    expect(await b.outbox.runDeliveries()).toMatchObject({ sent: 0 });
  });

  it("an entry Ben adds on B reaches Anna and her co-traveller on A, and goes no further back", async () => {
    const { anna, ben, groupId, benTrip } = await sharedFlight();
    // Dora shares Anna's trip on A (a local member with consent): the home fans out to her.
    const dora = await harnessUser(a, "Dora");
    await a.prisma.shareConsent.create({
      data: { requesterId: anna, targetId: dora, status: "accepted" },
    });
    await a.prisma.trip.create({ data: { userId: dora, name: "Lissabon", shareGroupId: groupId } });

    const added = await b.prisma.flight.create({
      data: {
        userId: ben,
        tripId: benTrip,
        flightNumber: "LH1173",
        depIata: "LIS",
        arrIata: "MUC",
        depLat: 38.77,
        depLon: -9.13,
        arrLat: 48.35,
        arrLon: 11.79,
      },
    });
    await b.propagate.propagateWrite(b.prisma, ben, "flight", added.id);
    expect(await b.outbox.runDeliveries()).toMatchObject({ sent: 1 });

    const onA = await a.prisma.flight.findMany({
      where: { flightNumber: "LH1173", userId: { in: [anna, dora] } },
    });
    expect(onA.map((f) => f.userId).sort()).toEqual([anna, dora].sort());
    for (const who of [anna, dora]) {
      const [created] = await noticesOf(a, who, "created");
      expect(created).toMatchObject({ remoteActor: { displayName: "Ben", origin: B } });
    }
    // Never echoed back to B.
    expect(await a.prisma.tripShareOutbox.count({ where: { groupId, peerOrigin: B } })).toBe(0);

    // Anna deletes it: Ben is told, his copy stays (deletes never propagate).
    const annas = onA.find((f) => f.userId === anna)!;
    const gone = await a.propagate.shareSnapshot(a.prisma, "flight", annas.id);
    await a.prisma.$transaction(async (tx) => {
      await tx.flight.delete({ where: { id: annas.id } });
      await a.propagate.propagateDelete(tx, anna, gone);
    });
    await a.outbox.runDeliveries();
    expect(await b.prisma.flight.count({ where: { id: added.id } })).toBe(1);
    const [deleted] = await noticesOf(b, ben, "deleted");
    expect(deleted).toMatchObject({
      remoteActor: { displayName: "Anna", origin: A },
      after: expect.objectContaining({ reason: "deleted" }),
    });
  });
});

describe("changed at the same time on both servers", () => {
  it("a conflict notice on both sides, nothing swapped; one answer settles both", async () => {
    const { anna, ben, flight, benFlight } = await sharedFlight();
    await setGate(a, anna, flight.id, "B2");
    await setGate(b, ben, benFlight.id, "C3");
    await a.outbox.runDeliveries();
    await b.outbox.runDeliveries();

    // Nobody's value was overwritten — the two edits did not end up swapped.
    expect(await gateOf(a, flight.id)).toBe("B2");
    expect(await gateOf(b, benFlight.id)).toBe("C3");
    const [onA] = await noticesOf(a, anna, "conflict");
    const [onB] = await noticesOf(b, ben, "conflict");
    expect(await noticesOf(a, anna, "conflict")).toHaveLength(1);
    expect(await noticesOf(b, ben, "conflict")).toHaveLength(1);
    expect(onA).toMatchObject({
      remoteActor: { displayName: "Ben", origin: B },
      changes: [{ field: "gate", before: { value: "B2" }, after: { value: "C3" } }],
    });
    expect(onB).toMatchObject({
      remoteActor: { displayName: "Anna", origin: A },
      changes: [{ field: "gate", before: { value: "C3" }, after: { value: "B2" } }],
    });

    // Ben takes Anna's value: an ordinary change that reaches A, which already holds it.
    await b.conflicts.resolveConflict(ben, onB.id, "theirs");
    await b.outbox.runDeliveries();
    expect(await gateOf(b, benFlight.id)).toBe("B2");
    expect(await gateOf(a, flight.id)).toBe("B2");
    const settled = await noticesOf(a, anna, "conflict");
    expect(settled[0].undoneAt).not.toBeNull();
  });

  it("keeping one's own value sends it again, and the other side takes it", async () => {
    const { anna, ben, flight, benFlight } = await sharedFlight();
    await setGate(a, anna, flight.id, "B2");
    await setGate(b, ben, benFlight.id, "C3");
    await a.outbox.runDeliveries();
    await b.outbox.runDeliveries();
    const [onA] = await noticesOf(a, anna, "conflict");
    await a.conflicts.resolveConflict(anna, onA.id, "mine");
    await a.outbox.runDeliveries();
    expect(await gateOf(b, benFlight.id)).toBe("B2");
    // Anna's decision settled Ben's notice too; he got the change as an ordinary one, with undo.
    const [onB] = await noticesOf(b, ben, "conflict");
    expect(onB.undoneAt).not.toBeNull();
    expect(await noticesOf(b, ben, "updated")).toEqual([
      expect.objectContaining({ changes: [expect.objectContaining({ field: "gate" })] }),
    ]);
  });

  it("an answer against a copy that moved since the conflict is refused by name", async () => {
    const { anna, ben, flight, benFlight } = await sharedFlight();
    await setGate(a, anna, flight.id, "B2");
    await setGate(b, ben, benFlight.id, "C3");
    await a.outbox.runDeliveries();
    await b.outbox.runDeliveries();
    const [onB] = await noticesOf(b, ben, "conflict");
    await setGate(b, ben, benFlight.id, "D4");
    await expect(b.conflicts.resolveConflict(ben, onB.id, "theirs")).rejects.toMatchObject({
      code: "SHARE_REMOTE_CONFLICT_STALE",
      extra: { fields: "gate" },
    });
    expect(await gateOf(b, benFlight.id)).toBe("D4");
  });
});

describe("what the sender's trip page says when a change does not arrive (spec §7)", () => {
  it("an offline server: retried with backoff, then shown unreachable; delivered once it answers", async () => {
    const { anna, flight, benFlight, trip } = await sharedFlight();
    setOffline(B, true);
    await setGate(a, anna, flight.id, "B2");
    const t0 = new Date();
    expect(await a.outbox.runDeliveries(t0)).toMatchObject({ sent: 0, failed: 1 });
    expect(await memberOn(a, anna, trip.id)).toMatchObject({
      state: "active",
      delivery: { state: "retrying", stateSince: t0.toISOString(), reason: "unreachable" },
    });
    // Before the first backoff runs out nothing is tried.
    expect(await a.outbox.runDeliveries(new Date(t0.getTime() + 30_000))).toMatchObject({
      failed: 0,
    });
    const [row] = await a.prisma.tripShareOutbox.findMany({ where: { failingSince: t0 } });
    expect(row.nextAttemptAt.getTime() - t0.getTime()).toBe(MINUTE);
    expect(await a.outbox.runDeliveries(new Date(t0.getTime() + 2 * MINUTE))).toMatchObject({
      failed: 1,
    });
    expect(
      (await a.prisma.tripShareOutbox.findUniqueOrThrow({ where: { id: row.id } })).attempts
    ).toBe(2);
    // Fourteen days after the first failure, Ben is shown unreachable since then.
    await a.outbox.runDeliveries(new Date(t0.getTime() + 15 * DAY));
    expect(await memberOn(a, anna, trip.id)).toMatchObject({
      state: "unreachable",
      delivery: { state: "unreachable", stateSince: t0.toISOString() },
    });
    expect(await gateOf(b, benFlight.id)).toBe("A1");

    setOffline(B, false);
    await a.outbox.runDeliveries(new Date(t0.getTime() + 20 * DAY));
    expect(await gateOf(b, benFlight.id)).toBe("B2");
    expect(await memberOn(a, anna, trip.id)).toMatchObject({
      state: "active",
      delivery: { state: "delivered" },
    });
  });

  it("keeps the order across retries", async () => {
    const { anna, ben, flight, benFlight } = await sharedFlight();
    setOffline(B, true);
    for (const gate of ["G1", "G2", "G3"]) await setGate(a, anna, flight.id, gate);
    const t0 = new Date();
    await a.outbox.runDeliveries(t0);
    await a.outbox.runDeliveries(new Date(t0.getTime() + 2 * MINUTE));
    setOffline(B, false);
    const served = jest.spyOn(b.inbound, "servePropagation");
    expect(await a.outbox.runDeliveries(new Date(t0.getTime() + 10 * MINUTE))).toMatchObject({
      sent: 3,
    });
    const seqs = served.mock.calls.map(([, m]) => m.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(
      served.mock.calls.map(([, m]) => (m as { changes: { after: unknown }[] }).changes[0].after)
    ).toEqual(["G1", "G2", "G3"]);
    expect(await gateOf(b, benFlight.id)).toBe("G3");
    expect(await noticesOf(b, ben, "conflict")).toHaveLength(0);
  });

  it("a message the other server refuses is parked with its reason; the next one still goes", async () => {
    const { anna, flight, benFlight, trip, groupId } = await sharedFlight();
    await setGate(a, anna, flight.id, "B2");
    // As a newer server might send it: a fact this receiver's wire contract does not know.
    const queued = await a.prisma.tripShareOutbox.findFirstOrThrow({
      where: { kind: "fact-update", groupId },
    });
    const payload = queued.payload as { changes: { field: string }[] };
    await a.prisma.tripShareOutbox.update({
      where: { id: queued.id },
      data: {
        payload: { ...payload, changes: [{ field: "seatNumber", before: null, after: "12A" }] },
      },
    });
    await editFlight(a, anna, flight.id, { terminal: "T1" });
    expect(await a.outbox.runDeliveries()).toMatchObject({ parked: 1, sent: 1 });
    expect(await memberOn(a, anna, trip.id)).toMatchObject({
      state: "active",
      delivery: {
        state: "rejected",
        reason: "schema",
        field: "changes.0.field",
        label: "TP571 FRA → LIS",
      },
    });
    const onB = await b.prisma.flight.findUniqueOrThrow({ where: { id: benFlight.id } });
    expect(onB).toMatchObject({ gate: "A1", terminal: "T1", seatNumber: null });
    // Parked means not retried.
    expect(await a.outbox.runDeliveries(new Date(Date.now() + DAY))).toMatchObject({
      sent: 0,
      parked: 0,
      failed: 0,
    });
  });

  it("switched off on the other server: suspended as off, and active again once it is back on", async () => {
    const { anna, flight, benFlight, trip } = await sharedFlight();
    await setSwitch(b, false);
    await setGate(a, anna, flight.id, "B2");
    const t0 = new Date();
    await a.outbox.runDeliveries(t0);
    expect(await memberOn(a, anna, trip.id)).toMatchObject({
      state: "suspended",
      stateReason: "off",
      delivery: { state: "retrying", reason: "remote-absent" },
    });
    await setSwitch(b, true);
    await a.outbox.runDeliveries(new Date(t0.getTime() + 2 * MINUTE));
    expect(await gateOf(b, benFlight.id)).toBe("B2");
    expect(await memberOn(a, anna, trip.id)).toMatchObject({ state: "active", stateReason: null });
  });

  it("the other server blocked by this server's admin: suspended as peer-blocked, the queue kept", async () => {
    const { anna, flight, trip, groupId } = await sharedFlight();
    await pin(a, b, { enabled: false });
    await setGate(a, anna, flight.id, "B2");
    await a.outbox.runDeliveries();
    expect(await memberOn(a, anna, trip.id)).toMatchObject({
      state: "suspended",
      stateReason: "peer-blocked",
      delivery: { state: "retrying" },
    });
    expect(await a.prisma.tripShareOutbox.count({ where: { groupId } })).toBe(1);
  });

  it("a gap is resumed from the seq the other server expects, with nothing to tell", async () => {
    const { anna, flight, benFlight, trip, benTrip } = await sharedFlight();
    const groupOnB = (await b.prisma.trip.findUniqueOrThrow({ where: { id: benTrip } }))
      .shareGroupId as string;
    await b.prisma.tripSharePeerStream.update({
      where: { groupId_peerOrigin: { groupId: groupOnB, peerOrigin: A } },
      data: { lastReceivedSeq: { increment: 1 } },
    });
    await setGate(a, anna, flight.id, "B2");
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 1, failed: 0 });
    expect(await gateOf(b, benFlight.id)).toBe("B2");
    expect(await memberOn(a, anna, trip.id)).toMatchObject({ delivery: { state: "delivered" } });
  });
});

describe("a queued message is a reference to a permission that must still hold", () => {
  it("is dropped, not sent, once the consent with that person is withdrawn", async () => {
    const { anna, flight, benFlight } = await sharedFlight();
    await setGate(a, anna, flight.id, "B2");
    await a.prisma.shareConsent.updateMany({
      where: { requesterId: anna, remoteTargetId: { not: null } },
      data: { status: "withdrawn" },
    });
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 0, dropped: 1 });
    expect(await gateOf(b, benFlight.id)).toBe("A1");
  });
});

describe("who a received change is by: a claim is believed only where it can be checked", () => {
  const ELSEWHERE = "https://c.two-servers.test";

  /** Rewrite the author the next queued message claims, as a lying server would. */
  async function claim(s: Server, actor: Record<string, unknown>) {
    const row = await s.prisma.tripShareOutbox.findFirstOrThrow({
      where: { kind: "fact-update", parkedAt: null },
      orderBy: { position: "desc" },
    });
    await s.prisma.tripShareOutbox.update({
      where: { id: row.id },
      data: { payload: { ...(row.payload as object), actor } },
    });
  }

  it("a spoke naming someone on another server is attributed to its own pairing", async () => {
    const { anna, ben, benFlight } = await sharedFlight();
    await setGate(b, ben, benFlight.id, "S1");
    await claim(b, { displayName: "Mallory", origin: ELSEWHERE });
    await b.outbox.runDeliveries();
    const [onA] = await noticesOf(a, anna, "updated");
    expect(onA.remoteActor).toEqual({ displayName: "Ben", origin: B });
  });

  it("the home relaying a change by one of its members keeps that member's name", async () => {
    const { anna, ben, groupId, flight } = await sharedFlight();
    const dora = await harnessUser(a, "Dora");
    await a.prisma.shareConsent.create({
      data: { requesterId: anna, targetId: dora, status: "accepted" },
    });
    const doraTrip = await a.prisma.trip.create({
      data: { userId: dora, name: "Lissabon", shareGroupId: groupId },
    });
    // Dora's copy of the shared flight: same key, same facts that matter here.
    const keyed = await a.prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    const doras = await a.prisma.flight.create({
      data: {
        userId: dora,
        tripId: doraTrip.id,
        shareKey: keyed.shareKey,
        flightNumber: keyed.flightNumber,
        depIata: keyed.depIata,
        arrIata: keyed.arrIata,
        depLat: keyed.depLat,
        depLon: keyed.depLon,
        arrLat: keyed.arrLat,
        arrLon: keyed.arrLon,
        gate: keyed.gate,
      },
    });
    await setGate(a, dora, doras.id, "D9");
    await a.outbox.runDeliveries();
    const [onB] = await noticesOf(b, ben, "updated");
    expect(onB.remoteActor).toEqual({ displayName: "Dora", origin: A });
  });

  it("the home naming a server that is not in the group is attributed to the home's pairing", async () => {
    const { anna, ben, flight } = await sharedFlight();
    await setGate(a, anna, flight.id, "H1");
    await claim(a, { displayName: "Mallory", origin: ELSEWHERE });
    await a.outbox.runDeliveries();
    const [onB] = await noticesOf(b, ben, "updated");
    expect(onB.remoteActor).toEqual({ displayName: "Anna", origin: A });
  });

  it("refuses an author origin that is not in canonical form", async () => {
    const { anna, flight, trip, benFlight } = await sharedFlight();
    await setGate(a, anna, flight.id, "N1");
    await claim(a, { displayName: "Anna", origin: `${B.toUpperCase()}/` });
    expect(await a.outbox.runDeliveries()).toMatchObject({ parked: 1, sent: 0 });
    expect(await memberOn(a, anna, trip.id)).toMatchObject({
      delivery: { state: "rejected", reason: "schema", field: "actor.origin" },
    });
    expect(await gateOf(b, benFlight.id)).toBe("A1");
  });
});
