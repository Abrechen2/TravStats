/**
 * The second cold review before 2.7.0-rc.19 (2026-10-21), each finding as the scenario that
 * showed it, over real TLS between the harness's servers: Anna on A (the home), Ben on B.
 */
import { servers, user as harnessUser, useTwoServers, type Server } from "./twoServerHarness";
import { addFlight, membersOn, offerAndAccept, pairAcross } from "./sharedTripFixtures";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

describe("a trip shared locally before authors were recorded, offered across servers", () => {
  it("says on the trip page that its earlier entries did not travel, instead of looking delivered", async () => {
    const anna = await harnessUser(a, "Anna");
    const ben = await harnessUser(b, "Ben");
    const remote = await pairAcross(a, anna, b, ben);
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
    // Shared on this server before rc.19: a group, a keyed entry, no author record.
    const group = await a.prisma.tripShareGroup.create({ data: { createdById: anna } });
    await a.prisma.trip.update({ where: { id: trip.id }, data: { shareGroupId: group.id } });
    const flight = await addFlight(a, anna, trip.id);
    await a.prisma.flight.update({
      where: { id: flight.id },
      data: { shareKey: "11111111-1111-4111-8111-111111111111" },
    });

    const benTrip = await offerAndAccept(a, anna, trip.id, remote.id, b, ben);

    // The documented working assumption (spec, F-S4e owner question 7): it is not copied ...
    expect(await b.prisma.flight.count({ where: { tripId: benTrip } })).toBe(0);
    // ... but the sender is told, not shown a clean delivery.
    const [member] = await membersOn(a, anna, trip.id);
    expect(member.stateReason).toBe("entries-unattributed");
    expect(member.delivery.state).toBe("delivered");
  });
});
