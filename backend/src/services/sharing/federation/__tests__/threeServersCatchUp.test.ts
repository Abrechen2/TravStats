/**
 * Catch-up after a roster yes (spec 2026-10-20, Q4 of 2026-10-21), on three servers: Anna on A is
 * the home, Ben on B and Cleo on C. What Cleo did before Ben said yes to her was withheld on B;
 * Ben's yes asks A for the current state (`resync`), and it arrives — her flight as a copy, her
 * gate as a write — with nothing duplicated by a second resync, and nothing by anyone Ben has not
 * said yes to ever leaving A.
 */
import { C, A, servers, useThreeServers, type Server } from "./twoServerHarness";
import { addFlight, editFlight, gateOf, noticesOf, threeServerTrip } from "./sharedTripFixtures";

useThreeServers();
let a: Server;
let b: Server;
let c: Server;
beforeAll(() => {
  ({ a, b, c } = servers);
});

const rosterOf = async (s: Server, userId: string, tripId: string) =>
  (await s.tripRemoteSharing.tripRemoteSharing(userId, tripId)).roster;

/** Cleo adds a flight and moves the gate of Anna's; both reach Anna and are withheld on B. */
async function cleoActsBeforeBensYes() {
  const t = await threeServerTrip(a, b, c);
  const hers = await addFlight(c, t.cleo, t.cleoTrip);
  await c.propagate.propagateWrite(c.prisma, t.cleo, "flight", hers.id);
  await editFlight(c, t.cleo, t.cleoFlight.id, { gate: "C1" });
  await c.outbox.runDeliveries();
  await a.outbox.runDeliveries();
  expect(await gateOf(a, t.flight.id)).toBe("C1");
  expect(await gateOf(b, t.benFlight.id)).toBe("A1");
  expect(await b.prisma.flight.count({ where: { tripId: t.benTrip } })).toBe(1);
  const key = (await c.prisma.flight.findUniqueOrThrow({ where: { id: hers.id } }))
    .shareKey as string;
  const cleoRef = (await rosterOf(b, t.ben, t.benTrip)).find((p) => p.displayName === "Cleo")!.ref;
  const groupOnB = (await b.prisma.trip.findUniqueOrThrow({ where: { id: t.benTrip } }))
    .shareGroupId as string;
  return { ...t, key, cleoRef, groupOnB };
}

/** Deliver B's queue, then A's: a resync there and its answer back. */
async function roundTrip() {
  const up = await b.outbox.runDeliveries();
  const down = await a.outbox.runDeliveries();
  return { up, down };
}

describe("a roster yes catches up (Q4)", () => {
  it("what Cleo did before Ben's yes arrives after it: her flight copied, her gate written", async () => {
    const t = await cleoActsBeforeBensYes();
    await b.roster.decideRosterPerson(t.ben, t.benTrip, t.cleoRef, "accepted");
    const { up, down } = await roundTrip();
    expect(up).toMatchObject({ sent: 1, parked: 0 });
    expect(down).toMatchObject({ sent: 1, parked: 0 });

    expect(await b.prisma.flight.count({ where: { tripId: t.benTrip } })).toBe(2);
    expect(await gateOf(b, t.benFlight.id)).toBe("C1");
    const [updated] = await noticesOf(b, t.ben, "updated");
    expect(updated.remoteActor).toEqual({ displayName: "Cleo", origin: C, via: A });
    const [created] = await noticesOf(b, t.ben, "created");
    expect(created.remoteActor).toEqual({ displayName: "Cleo", origin: C, via: A });
    expect(await noticesOf(b, t.ben, "conflict")).toHaveLength(0);
    // Decided: nothing withheld is left to judge.
    expect(await b.prisma.tripShareWithheld.count({ where: { userId: t.ben } })).toBe(0);
  });

  it("a second resync is a no-op: nothing copied twice, no conflict, no notice", async () => {
    const t = await cleoActsBeforeBensYes();
    await b.roster.decideRosterPerson(t.ben, t.benTrip, t.cleoRef, "accepted");
    await roundTrip();
    const notices = (await noticesOf(b, t.ben)).length;

    await b.prisma.$transaction((tx) => b.resync.queueResync(tx, t.ben, t.groupOnB));
    expect(await roundTrip()).toMatchObject({ up: { sent: 1 }, down: { sent: 1 } });
    expect(await b.prisma.flight.count({ where: { tripId: t.benTrip } })).toBe(2);
    expect(await gateOf(b, t.benFlight.id)).toBe("C1");
    expect(await noticesOf(b, t.ben)).toHaveLength(notices);
  });

  it("a request is not queued twice while one waits, nor answered twice while one waits", async () => {
    const t = await cleoActsBeforeBensYes();
    await b.roster.decideRosterPerson(t.ben, t.benTrip, t.cleoRef, "accepted");
    await b.prisma.$transaction((tx) => b.resync.queueResync(tx, t.ben, t.groupOnB));
    expect(await b.prisma.tripShareOutbox.count({ where: { kind: "resync" } })).toBe(1);

    await b.outbox.runDeliveries();
    // A second request reaches A while its first answer still waits there: nothing more queued.
    await b.prisma.$transaction((tx) => b.resync.queueResync(tx, t.ben, t.groupOnB));
    await b.outbox.runDeliveries();
    const answers = await a.prisma.tripShareOutbox.findMany({
      where: { kind: "entries", peerOrigin: b.origin },
    });
    expect(answers).toHaveLength(1);
  });

  it("an entry by someone Ben said no to never leaves A on a resync, and her gate stays", async () => {
    const t = await cleoActsBeforeBensYes();
    await b.roster.decideRosterPerson(t.ben, t.benTrip, t.cleoRef, "declined");
    // A resync for another reason (a restore's confirmation asks the same).
    await b.prisma.$transaction((tx) => b.resync.queueResync(tx, t.ben, t.groupOnB));
    await b.outbox.runDeliveries();
    const [answer] = await a.prisma.tripShareOutbox.findMany({
      where: { kind: "entries", peerOrigin: b.origin },
    });
    const sent = (answer.payload as { entries: { shareKey: string }[] }).entries.map(
      (e) => e.shareKey
    );
    expect(sent).not.toContain(t.key);
    expect(sent).toHaveLength(1);
    await a.outbox.runDeliveries();
    expect(await b.prisma.flight.count({ where: { tripId: t.benTrip } })).toBe(1);
    // Withheld from someone he still says no to: left as it is, not even a conflict.
    expect(await gateOf(b, t.benFlight.id)).toBe("A1");
    expect(await noticesOf(b, t.ben, "conflict")).toHaveLength(0);
  });

  it("B gates again what a home sends on a resync: an author Ben did not agree to is not copied", async () => {
    const t = await cleoActsBeforeBensYes();
    // A home that ignores `accepted` (or a stale list): the request claims a yes Ben never gave.
    await b.prisma.tripShareOutbox.create({
      data: await resyncRowClaiming(t.ben, t.groupOnB, [t.cleoRef]),
    });
    await roundTrip();
    expect(await b.prisma.flight.count({ where: { tripId: t.benTrip } })).toBe(1);
    expect(await gateOf(b, t.benFlight.id)).toBe("A1");
  });
});

/** An outbox row for a resync naming `accepted` refs, as a forged request would. */
async function resyncRowClaiming(ben: string, groupId: string, accepted: string[]) {
  const member = await b.prisma.tripShareRemoteMember.findFirstOrThrow({
    where: { groupId, remote: { userId: ben } },
    include: { remote: true },
  });
  return {
    groupId,
    memberId: member.id,
    peerOrigin: member.remote.origin,
    kind: "resync",
    payload: { from: member.remote.localChannel, to: member.remote.channel, accepted },
  };
}
