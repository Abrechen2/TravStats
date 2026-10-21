/**
 * The cold review of F-S4e (2026-10-21), each finding as the scenario that showed it, over real
 * TLS between the harness's servers: Anna on A (the home) shares a trip with Ben on B.
 */
import { Client } from "pg";
import { A, B, servers, user as harnessUser, useTwoServers, type Server } from "./twoServerHarness";
import {
  addFlight,
  editFlight,
  gateOf,
  membersOn,
  pairAcross,
  sharedFlight,
} from "./sharedTripFixtures";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

describe("entries for a membership the spoke shows as held up (review 6)", () => {
  it.each(["unreachable", "off"])(
    "are copied while B shows the home as %s, not parked for good",
    async (held) => {
      const { anna, ben, trip, benTrip } = await sharedFlight(a, b);
      const member = await b.prisma.tripShareRemoteMember.findFirstOrThrow({
        where: { remote: { userId: ben, origin: A } },
      });
      await b.prisma.tripShareRemoteMember.update({
        where: { id: member.id },
        data:
          held === "off"
            ? { state: "suspended", stateReason: "off" }
            : { state: "unreachable", stateReason: "unreachable" },
      });
      await addFlight(a, anna, trip.id);
      const onA = await a.prisma.tripShareRemoteMember.findFirstOrThrow({
        where: { remote: { userId: anna, origin: B } },
      });
      await a.entries.deliverEntries(onA.id);
      expect(await a.outbox.runDeliveries()).toMatchObject({ parked: 0 });
      expect(await b.prisma.flight.count({ where: { tripId: benTrip } })).toBe(2);
      expect((await membersOn(a, anna, trip.id))[0].delivery.state).toBe("delivered");
    }
  );
});

/** A connection of its own to A's database, outside A's pool. */
async function ownConnectionToA(): Promise<Client> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.search = "";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

describe("two roster changes at once (review 7)", () => {
  it("take their snapshots one after the other: the later one names what the first wrote", async () => {
    const { groupId } = await sharedFlight(a, b);
    const dora = await harnessUser(a, "Dora");
    const doraTrip = await a.prisma.trip.create({ data: { userId: dora, name: "Lissabon" } });
    const other = await ownConnectionToA();
    try {
      // Dora joins in a transaction that holds the group while it sends its own roster.
      await other.query("BEGIN");
      await other.query("SELECT 1 FROM trip_share_groups WHERE id = $1 FOR UPDATE", [groupId]);
      await other.query("UPDATE trips SET share_group_id = $1 WHERE id = $2", [
        groupId,
        doraTrip.id,
      ]);
      const queued = a.prisma.$transaction((tx) => a.roster.queueRoster(tx, groupId));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await other.query("COMMIT");
      await queued;
    } finally {
      await other.end();
    }
    const [roster] = await a.prisma.tripShareOutbox.findMany({
      where: { groupId, kind: "roster" },
      orderBy: { position: "desc" },
      take: 1,
    });
    const names = (roster.payload as { members: { displayName: string }[] }).members.map(
      (m) => m.displayName
    );
    expect(names).toContain("Dora");
  });
});

describe("confirming again while the trip is left (review 4)", () => {
  it("does not bring back a membership that ended meanwhile", async () => {
    const { anna, trip } = await sharedFlight(a, b);
    await a.lifecycle.holdPeerMemberships(B, "repinned");
    // Anna leaves the trip while her confirmation is under way (between its read and its write).
    const peers = a.prisma.comparisonPeer;
    const findPeer = peers.findUnique.bind(peers);
    jest.spyOn(peers, "findUnique").mockImplementationOnce((async (args: never) => {
      await a.shareTrip.leaveGroup(anna, trip.id);
      return findPeer(args);
    }) as never);
    await a.lifecycle.reconfirmTrip(anna, trip.id).catch(() => undefined);
    const member = await a.prisma.tripShareRemoteMember.findFirstOrThrow({
      where: { remote: { userId: anna, origin: B } },
    });
    expect(member.state).toBe("left");
  });
});

describe("an offer still open when the spoke was restored (review 5)", () => {
  it("is listed again, and taking it confirms the pairing and brings the trip", async () => {
    const anna = await harnessUser(a, "Anna");
    const ben = await harnessUser(b, "Ben");
    const remote = await pairAcross(a, anna, b, ben);
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
    await addFlight(a, anna, trip.id);
    await a.offers.offerTrip(anna, trip.id, remote.id);
    await b.restore.suspendTripFederationAfterRestore();
    const [offer] = await b.offerInbox.listReceivedOffers(ben);
    expect(offer).toMatchObject({ from: { displayName: "Anna", origin: A } });
    const { tripId } = await b.offerInbox.acceptOffer(ben, offer.id);
    await a.outbox.runDeliveries();
    expect(await b.prisma.flight.count({ where: { tripId } })).toBe(1);
    expect(
      await b.prisma.shareConsent.count({
        where: { targetId: ben, remoteRequester: { origin: A }, status: "accepted" },
      })
    ).toBe(1);
  });
});

describe("a delivery waiting behind another message when the consent is withdrawn (review 3)", () => {
  it("is not sent once the withdrawal committed", async () => {
    const { ben, benTrip, benFlight, flight } = await sharedFlight(a, b);
    await editFlight(b, ben, benFlight.id, { gate: "C3" });
    const exchange = b.security.exchange.bind(b.security);
    // Ben's own request to the home is slow on the wire; the delivery queues behind it.
    jest.spyOn(b.security, "exchange").mockImplementationOnce((async (...args: never[]) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return (exchange as (...a: never[]) => Promise<unknown>)(...args);
    }) as never);
    const request = b.addRequest.requestAddition(ben, benTrip, { displayName: "Bea" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const pass = b.outbox.runDeliveries();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pairing = await b.prisma.remoteShareAccount.findFirstOrThrow({
      where: { userId: ben, origin: A },
    });
    await b.lifecycle.withdrawRemoteConsent(ben, pairing.id);
    await request;
    await pass;
    expect(await gateOf(a, flight.id)).toBe("A1");
  });
});

describe("a withdrawal while a received change is being applied (review 2)", () => {
  it("waits for it: no change is written after the withdrawal committed", async () => {
    const { anna, ben, remote, flight, benFlight } = await sharedFlight(a, b);
    await editFlight(b, ben, benFlight.id, { gate: "C3" });
    const adapter = a.adapters.ADAPTERS.flight;
    const apply = adapter.apply.bind(adapter);
    let withdrawal: Promise<unknown> = Promise.resolve();
    let withdrawnBeforeWrite: boolean | null = null;
    jest.spyOn(adapter, "apply").mockImplementationOnce(async (...args) => {
      let done = false;
      withdrawal = a.lifecycle.withdrawRemoteConsent(anna, remote.id).finally(() => (done = true));
      await new Promise((resolve) => setTimeout(resolve, 300));
      withdrawnBeforeWrite = done;
      return apply(...args);
    });
    await b.outbox.runDeliveries();
    await withdrawal;
    // The change checked against the membership as it stood; the withdrawal comes after it.
    expect(withdrawnBeforeWrite).toBe(false);
    expect(await gateOf(a, flight.id)).toBe("C3");
  });
});

describe("the locks of the review fixes, against each other (review round 2)", () => {
  const isDeadlock = (e: unknown) => /deadlock|40P01|P2034/i.test(String(e));

  it("entries hold the membership while they are copied: a hold waits for them", async () => {
    const { anna, ben, trip, benTrip } = await sharedFlight(a, b);
    await addFlight(a, anna, trip.id);
    const onA = await a.prisma.tripShareRemoteMember.findFirstOrThrow({
      where: { remote: { userId: anna, origin: B } },
    });
    await a.entries.deliverEntries(onA.id);
    const adapter = b.adapters.ADAPTERS.flight;
    const createCopy = adapter.createCopy.bind(adapter);
    let hold: Promise<unknown> = Promise.resolve();
    let heldBeforeCopy: boolean | null = null;
    jest.spyOn(adapter, "createCopy").mockImplementationOnce(async (...args) => {
      let done = false;
      hold = b.lifecycle.holdPeerMemberships(A, "repinned").finally(() => (done = true));
      await new Promise((resolve) => setTimeout(resolve, 300));
      heldBeforeCopy = done;
      return createCopy(...args);
    });
    await a.outbox.runDeliveries();
    await hold;
    expect(heldBeforeCopy).toBe(false);
    expect(await b.prisma.flight.count({ where: { tripId: benTrip } })).toBe(2);
    void ben;
  });

  it("a roster can be queued while a received message holds a membership", async () => {
    const { anna, ben, groupId, flight, benFlight } = await sharedFlight(a, b);
    await editFlight(b, ben, benFlight.id, { gate: "C3" });
    const adapter = a.adapters.ADAPTERS.flight;
    const apply = adapter.apply.bind(adapter);
    let rosterBeforeApply: boolean | null = null;
    jest.spyOn(adapter, "apply").mockImplementationOnce(async (...args) => {
      let done = false;
      const queued = a.prisma
        .$transaction((tx) => a.roster.queueRoster(tx, groupId))
        .finally(() => (done = true));
      await new Promise((resolve) => setTimeout(resolve, 300));
      rosterBeforeApply = done;
      await apply(...args);
      await queued;
    });
    await b.outbox.runDeliveries();
    expect(rosterBeforeApply).toBe(true);
    expect(await gateOf(a, flight.id)).toBe("C3");
    void anna;
  });

  it("a leave while a received change waits for its turn does not deadlock with it", async () => {
    const { anna, ben, trip, benFlight } = await sharedFlight(a, b);
    await editFlight(b, ben, benFlight.id, { gate: "C3" });
    const takeSeq = a.streams.takeSeq.bind(a.streams);
    let leave: Promise<unknown> = Promise.resolve();
    jest.spyOn(a.streams, "takeSeq").mockImplementationOnce(async (...args) => {
      leave = a.shareTrip.leaveGroup(anna, trip.id);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return takeSeq(...args);
    });
    const run = await b.outbox.runDeliveries();
    await expect(leave).resolves.toEqual({ left: true });
    expect(run.failed).toBe(0);
  });

  it("confirming again and withdrawing at once do not deadlock", async () => {
    const { anna, remote, trip } = await sharedFlight(a, b);
    await a.restore.suspendTripFederationAfterRestore();
    const member = await a.prisma.tripShareRemoteMember.findFirstOrThrow({
      where: { remoteId: remote.id },
    });
    const other = await ownConnectionToA();
    try {
      // The withdrawal's order: the consent first, then the membership.
      await other.query("BEGIN");
      await other.query(
        "UPDATE share_consents SET status = 'withdrawn' WHERE remote_target_id = $1 OR remote_requester_id = $1",
        [remote.id]
      );
      const confirming = a.lifecycle.reconfirmTrip(anna, trip.id).catch((e: unknown) => e);
      await new Promise((resolve) => setTimeout(resolve, 300));
      let failure: unknown = null;
      try {
        await other.query("UPDATE trip_share_remote_members SET state = 'revoked' WHERE id = $1", [
          member.id,
        ]);
        await other.query("COMMIT");
      } catch (e) {
        failure = e;
        await other.query("ROLLBACK");
      }
      const result = await confirming;
      expect(isDeadlock(failure)).toBe(false);
      expect(isDeadlock(result)).toBe(false);
    } finally {
      await other.end();
    }
  });
});
