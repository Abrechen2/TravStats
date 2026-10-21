/**
 * The cold review of F-S4e (2026-10-21), each finding as the scenario that showed it, over real
 * TLS between the harness's servers: Anna on A (the home) shares a trip with Ben on B.
 */
import { A, B, servers, useTwoServers, type Server } from "./twoServerHarness";
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
