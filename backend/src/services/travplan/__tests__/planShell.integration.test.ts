import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { loadVisibleTravelAccountData } from "../../stats/travelAccountData";
import { buildSnapshot } from "../../federation/snapshots";
import { prepareScope } from "../../federation/permissions";

let userId: string;
beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: "plan-shell-" + randomUUID(), passwordHash: "not-a-login-password" },
    })
  ).id;
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

it("keeps a plan's empty shell trip out of stats and comparison snapshots", async () => {
  // Creating a plan creates a real Trip (status planned). With nothing booked or lived on it,
  // it still counted as a trip in the travel account and was listed to comparison friends.
  const plan = async (name: string) => {
    const trip = await prisma.trip.create({ data: { userId, name, status: "planned" } });
    await prisma.travelPlan.create({
      data: { tripId: trip.id, createRef: randomUUID(), state: {} },
    });
    return trip;
  };
  const shell = await plan("Only a plan");
  const lived = await plan("Planned and travelled");
  await prisma.tripJournalEntry.create({
    data: {
      tripId: lived.id,
      date: new Date("2025-05-01T00:00:00Z"),
      day: new Date("2025-05-01T00:00:00Z"),
      title: "Day one",
      body: "We arrived.",
    },
  });
  const ordinary = await prisma.trip.create({ data: { userId, name: "No plan at all" } });

  const account = await loadVisibleTravelAccountData(userId);
  const counted = account.trips.map((t) => t.id).sort();
  expect(counted).toEqual([lived.id, ordinary.id].sort());

  const snapshot = await buildSnapshot(
    userId,
    await prepareScope(userId, {
      statistics: true,
      details: true,
      costs: false,
      personal: false,
      photos: false,
      documents: false,
      domains: ["flight"],
      tripIds: [],
      futureTrips: true,
      year: null,
      precision: "exact",
      expiresAt: null,
    }),
    null
  );
  expect(snapshot.trips.map((t) => t.id)).not.toContain(shell.id);
  expect(snapshot.trips.map((t) => t.id).sort()).toEqual([lived.id, ordinary.id].sort());
});
