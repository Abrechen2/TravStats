/**
 * Three servers (spec 2026-10-20 F5, phase F-S4e): Anna on A is the home of a trip shared with
 * Ben on B and, later, Cleo on C. B and C are admitted by A only and never talk to each other;
 * A relays. Over real TLS between the harness's servers.
 *
 * - The roster: each spoke learns who is on the trip and names a relayed author by it, not by
 *   the name the message claims.
 * - Consent on relays: Cleo, the newcomer, reaches Ben's copy only after Ben said yes to her;
 *   Ben, already on the trip when Cleo took it, reaches hers at once (her yes was the offer).
 */
import {
  A,
  B,
  C,
  servers,
  user as harnessUser,
  useThreeServers,
  type Server,
} from "./twoServerHarness";
import {
  addFlight,
  editFlight,
  gateOf,
  noticesOf,
  offerAndAccept,
  pairAcross,
} from "./sharedTripFixtures";

useThreeServers();
let a: Server;
let b: Server;
let c: Server;
beforeAll(() => {
  ({ a, b, c } = servers);
});

/** Anna's trip shared with Ben, then with Cleo; every message delivered. */
async function threeOnATrip() {
  const anna = await harnessUser(a, "Anna");
  const ben = await harnessUser(b, "Ben");
  const cleo = await harnessUser(c, "Cleo");
  const toBen = await pairAcross(a, anna, b, ben);
  const toCleo = await pairAcross(a, anna, c, cleo);
  const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
  const flight = await addFlight(a, anna, trip.id);
  const benTrip = await offerAndAccept(a, anna, trip.id, toBen.id, b, ben);
  const cleoTrip = await offerAndAccept(a, anna, trip.id, toCleo.id, c, cleo);
  await a.outbox.runDeliveries();
  const flightOn = (s: Server, tripId: string) =>
    s.prisma.flight.findFirstOrThrow({ where: { tripId } });
  return {
    anna,
    ben,
    cleo,
    trip,
    flight,
    benTrip,
    cleoTrip,
    benFlight: await flightOn(b, benTrip),
    cleoFlight: await flightOn(c, cleoTrip),
  };
}

const rosterOf = async (s: Server, userId: string, tripId: string) =>
  (await s.tripRemoteSharing.tripRemoteSharing(userId, tripId)).roster;

describe("three servers, one home", () => {
  it("each spoke learns the roster; a newcomer is asked about, the people before are not", async () => {
    const { anna, ben, cleo, trip, benTrip, cleoTrip } = await threeOnATrip();
    const onB = await rosterOf(b, ben, benTrip);
    expect(onB).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: "Anna", origin: A, relation: "paired" }),
        expect.objectContaining({ displayName: "Ben", origin: B, relation: "you" }),
        expect.objectContaining({ displayName: "Cleo", origin: C, relation: "pending" }),
      ])
    );
    const onC = await rosterOf(c, cleo, cleoTrip);
    expect(onC).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: "Ben", origin: B, relation: "accepted" }),
        expect.objectContaining({ displayName: "Cleo", relation: "you" }),
      ])
    );
    // At the home, Anna is paired with both: nothing to ask.
    expect((await rosterOf(a, anna, trip.id)).map((p) => p.relation)).toEqual(["paired", "paired"]);
  });

  it("Cleo's change reaches Ben only after his yes; it is named Cleo, relayed by A", async () => {
    const { ben, cleo, flight, benTrip, benFlight, cleoFlight } = await threeOnATrip();
    await editFlight(c, cleo, cleoFlight.id, { gate: "C1" });
    expect(await c.outbox.runDeliveries()).toMatchObject({ sent: 1 });
    expect(await gateOf(a, flight.id)).toBe("C1");
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 1, parked: 0 });
    // Taken in order, not applied: Ben has not said yes to Cleo.
    expect(await gateOf(b, benFlight.id)).toBe("A1");
    expect(await noticesOf(b, ben, "updated")).toHaveLength(0);

    const cleoOnB = (await rosterOf(b, ben, benTrip)).find((p) => p.displayName === "Cleo");
    await b.roster.decideRosterPerson(ben, benTrip, cleoOnB!.ref, "accepted");
    // What he missed is not replayed: her next change meets his older value — both are shown,
    // nothing is overwritten.
    await editFlight(c, cleo, cleoFlight.id, { gate: "C2" });
    await c.outbox.runDeliveries();
    await a.outbox.runDeliveries();
    expect(await gateOf(b, benFlight.id)).toBe("A1");
    const [conflict] = await noticesOf(b, ben, "conflict");
    expect(conflict.remoteActor).toEqual({ displayName: "Cleo", origin: C, via: A });
  });

  it("after Ben's yes, Cleo's change lands on his copy, named Cleo, relayed by A", async () => {
    const { ben, cleo, benTrip, benFlight, cleoFlight } = await threeOnATrip();
    const cleoOnB = (await rosterOf(b, ben, benTrip)).find((p) => p.displayName === "Cleo");
    await b.roster.decideRosterPerson(ben, benTrip, cleoOnB!.ref, "accepted");
    await editFlight(c, cleo, cleoFlight.id, { gate: "C2" });
    await c.outbox.runDeliveries();
    await a.outbox.runDeliveries();
    expect(await gateOf(b, benFlight.id)).toBe("C2");
    const [updated] = await noticesOf(b, ben, "updated");
    expect(updated.remoteActor).toEqual({ displayName: "Cleo", origin: C, via: A });
  });

  it("Ben's change reaches Cleo at once, named Ben; B and C never talk to each other", async () => {
    const { cleo, ben, benFlight, cleoFlight } = await threeOnATrip();
    await editFlight(b, ben, benFlight.id, { gate: "B7" });
    await b.outbox.runDeliveries();
    await a.outbox.runDeliveries();
    expect(await gateOf(c, cleoFlight.id)).toBe("B7");
    const [updated] = await noticesOf(c, cleo, "updated");
    expect(updated.remoteActor).toEqual({ displayName: "Ben", origin: B, via: A });
    expect(await c.prisma.tripShareInbound.count({ where: { peerOrigin: B } })).toBe(0);
    expect(await b.prisma.tripShareInbound.count({ where: { peerOrigin: C } })).toBe(0);
  });

  it("a ref the home names that is not on the roster is not applied", async () => {
    const { anna, ben, flight, benFlight } = await threeOnATrip();
    await editFlight(a, anna, flight.id, { gate: "H1" });
    const row = await a.prisma.tripShareOutbox.findFirstOrThrow({
      where: { kind: "fact-update", peerOrigin: B, parkedAt: null },
    });
    await a.prisma.tripShareOutbox.update({
      where: { id: row.id },
      data: {
        payload: {
          ...(row.payload as object),
          actor: { displayName: "Anna", ref: crypto.randomUUID() },
        } as never,
      },
    });
    await a.outbox.runDeliveries();
    expect(await gateOf(b, benFlight.id)).toBe("A1");
    expect(await noticesOf(b, ben, "updated")).toHaveLength(0);
  });

  it("when Ben leaves, Cleo's roster no longer has him", async () => {
    const { ben, cleo, benTrip, cleoTrip } = await threeOnATrip();
    await b.shareTrip.leaveGroup(ben, benTrip);
    await b.outbox.runDeliveries();
    await a.outbox.runDeliveries();
    expect((await rosterOf(c, cleo, cleoTrip)).map((p) => p.displayName)).not.toContain("Ben");
  });

  it("a resend after a restore brings Ben nothing by Cleo he said no to (review 1)", async () => {
    const { anna, ben, cleo, trip, benTrip, cleoTrip } = await threeOnATrip();
    const cleoOnB = (await rosterOf(b, ben, benTrip)).find((p) => p.displayName === "Cleo");
    await b.roster.decideRosterPerson(ben, benTrip, cleoOnB!.ref, "declined");
    // Cleo adds a flight: it reaches Anna, and is withheld from Ben.
    const hers = await addFlight(c, cleo, cleoTrip);
    await c.propagate.propagateWrite(c.prisma, cleo, "flight", hers.id);
    await c.outbox.runDeliveries();
    await a.outbox.runDeliveries();
    expect(await a.prisma.flight.count({ where: { tripId: trip.id } })).toBe(2);
    expect(await b.prisma.flight.count({ where: { tripId: benTrip } })).toBe(1);

    await a.restore.suspendTripFederationAfterRestore();
    await a.lifecycle.reconfirmTrip(anna, trip.id);
    await a.outbox.runDeliveries();
    expect(await b.prisma.flight.count({ where: { tripId: benTrip } })).toBe(1);
    // Anna's own entries still go: a flight she added is resent and arrives.
    expect(await c.prisma.flight.count({ where: { tripId: cleoTrip } })).toBe(2);
  });

  it("a resent entry whose author the home has no record of reaches nobody who did not agree", async () => {
    const { anna, ben, cleo, trip, benTrip, cleoTrip } = await threeOnATrip();
    // Ben has not answered Cleo (pending). Cleo adds a flight; it reaches Anna only.
    const hers = await addFlight(c, cleo, cleoTrip);
    await c.propagate.propagateWrite(c.prisma, cleo, "flight", hers.id);
    await c.outbox.runDeliveries();
    await a.outbox.runDeliveries();
    expect(await b.prisma.flight.count({ where: { tripId: benTrip } })).toBe(1);
    // The home lost the record of who brought it in (as for an entry from before the record).
    const groupId = (await a.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } }))
      .shareGroupId as string;
    const key = (await c.prisma.flight.findUniqueOrThrow({ where: { id: hers.id } })).shareKey;
    await a.prisma.tripShareEntryAuthor.deleteMany({ where: { groupId, shareKey: key! } });

    await a.restore.suspendTripFederationAfterRestore();
    await a.lifecycle.reconfirmTrip(anna, trip.id);
    await a.outbox.runDeliveries();
    // Fails closed: no named author, not the home member's own, so not copied.
    expect(await b.prisma.flight.count({ where: { tripId: benTrip } })).toBe(1);
    void ben;
  });
});
