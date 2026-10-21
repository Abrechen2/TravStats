/**
 * The cold review of F-S4e (2026-10-21), each finding as the scenario that showed it, over real
 * TLS between the harness's servers: Anna on A (the home) shares a trip with Ben on B.
 */
import { Client } from "pg";
import { A, B, servers, user as harnessUser, useTwoServers, type Server } from "./twoServerHarness";
import { addFlight, membersOn, sharedFlight } from "./sharedTripFixtures";

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
