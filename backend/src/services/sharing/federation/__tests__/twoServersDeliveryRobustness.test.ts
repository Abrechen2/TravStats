/**
 * The outbox under the failures a cold review found (F-S4d review, 2026-10-20): an acknowledged
 * message whose deletion did not happen, a local edit landing between the receiver's check and
 * its write, catalogue references neither server can resolve, and a message too large on the
 * wire though small in characters. Each over real TLS between the harness's two servers.
 */
import { servers, user as harnessUser, useTwoServers, B, type Server } from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

async function pair(anna: string, ben: string) {
  const { code } = await a.invites.createTripInvite(anna);
  await b.claim.claimTripInvite(ben, code);
  return a.prisma.remoteShareAccount.findFirstOrThrow({ where: { userId: anna, origin: B } });
}

/** Anna's trip with one flight at gate A1, accepted by Ben, entries delivered. */
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

async function editFlight(s: Server, userId: string, flightId: string, data: object) {
  await s.prisma.$transaction(async (tx) => {
    const before = await s.propagate.shareSnapshot(tx, "flight", flightId);
    await tx.flight.update({ where: { id: flightId }, data });
    await s.propagate.propagateWrite(tx, userId, "flight", flightId, before);
  });
}

const flightOn = (s: Server, id: string) => s.prisma.flight.findUniqueOrThrow({ where: { id } });

describe("an acknowledged message whose row survived (review 1)", () => {
  it("is answered from the receiver's memory and leaves, instead of blocking the stream", async () => {
    const { anna, flight, benFlight, groupId } = await sharedFlight();
    await editFlight(a, anna, flight.id, { gate: "B2" });
    const [queued] = await a.prisma.tripShareOutbox.findMany({ where: { groupId } });
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 1 });
    // As if the process died after the ack and before the row was deleted.
    const { id: _position, ...row } = { ...queued, id: queued.position };
    await a.prisma.tripShareOutbox.create({
      data: { ...row, id: queued.id, payload: queued.payload as object } as never,
    });
    await editFlight(a, anna, flight.id, { terminal: "T1" });
    expect(await a.outbox.runDeliveries()).toMatchObject({ sent: 2, failed: 0 });
    expect(await flightOn(b, benFlight.id)).toMatchObject({ gate: "B2", terminal: "T1" });
    expect(await a.prisma.tripShareOutbox.count({ where: { groupId } })).toBe(0);
  });

  it("does not move the stream when recording the answer fails; the retry completes it", async () => {
    const { anna, ben, flight, benFlight, groupId } = await sharedFlight();
    await editFlight(a, anna, flight.id, { gate: "B2" });
    await editFlight(b, ben, benFlight.id, { gate: "C3" });
    const failOnce = jest
      .spyOn(a.conflicts, "recordConflict")
      .mockRejectedValueOnce(new Error("disk full"));
    const before = await a.prisma.tripSharePeerStream.findUniqueOrThrow({
      where: { groupId_peerOrigin: { groupId, peerOrigin: B } },
    });
    await a.outbox.runDeliveries();
    expect(failOnce).toHaveBeenCalled();
    const after = await a.prisma.tripSharePeerStream.findUniqueOrThrow({
      where: { groupId_peerOrigin: { groupId, peerOrigin: B } },
    });
    expect(after.lastSentSeq).toBe(before.lastSentSeq);
    expect(await a.prisma.tripShareOutbox.count({ where: { groupId } })).toBe(1);
    // The failure is retried after the first backoff, like any other.
    expect(await a.outbox.runDeliveries(new Date(Date.now() + 2 * 60_000))).toMatchObject({
      sent: 1,
      failed: 0,
    });
    expect(await a.prisma.tripShareOutbox.count({ where: { groupId } })).toBe(0);
    const notices = await a.notices.listNotices(anna);
    expect(notices.filter((n) => n.kind === "conflict")).toHaveLength(1);
  });
});
