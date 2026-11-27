/**
 * UAT 2026-11-27: "Reisen teilen" turned off still synced existing trips. Off now pauses the
 * link: nothing more is sent, the trip page says "paused", and switching it on again delivers what
 * waited — nothing is detached or lost.
 */
import { editFlight, gateOf, sharedFlight } from "./sharedTripFixtures";
import { servers, useTwoServers, type Server } from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

async function switchOffers(s: Server, userId: string, on: boolean) {
  const row = await s.prisma.remoteShareAccount.findFirstOrThrow({ where: { userId } });
  await s.connections.updateConnectionSwitches(userId, row.id, {
    plans: row.sharePlans,
    stats: row.statsLevel as "off",
    achievements: row.shareAchievements,
    leaderboard: row.shareLeaderboard,
    tripOffers: on,
  });
}

it("the receiver switching 'Reisen teilen' off pauses the link on both servers, and on resumes it", async () => {
  const t = await sharedFlight(a, b);
  await switchOffers(b, t.ben, false);
  await b.outbox.runDeliveries();

  await editFlight(a, t.anna, t.flight.id, { gate: "B7" });
  await a.outbox.runDeliveries();
  expect(await gateOf(b, t.benFlight.id)).toBe("A1");
  const view = await a.tripRemoteSharing.tripRemoteSharing(t.anna, t.trip.id);
  expect(view.members[0]?.delivery.state).toBe("paused");
  // The change waits; nothing was dropped.
  expect(await a.prisma.tripShareOutbox.count({ where: { groupId: t.groupId } })).toBeGreaterThan(
    0
  );

  await switchOffers(b, t.ben, true);
  await b.outbox.runDeliveries();
  await a.outbox.runDeliveries();
  expect(await gateOf(b, t.benFlight.id)).toBe("B7");
});
