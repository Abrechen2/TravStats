/**
 * Hand-drawn cruise lines are part of a shared cruise between two accounts of one server
 * (2026-11-24): copied with the share, carried by a later redraw, and given to groups shared
 * before by the one-off backfill — which never overwrites a recipient's own line.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { backfillSharedCruiseRoutes } from "../backfillCruiseRoutes";
import { propagateWrite, shareSnapshot } from "../propagate";
import { shareTripWithUser } from "../shareTrip";

const users: string[] = [];
const portIds: number[] = [];
const LINE = [
  [10, 54],
  [11, 55],
  [12, 56],
];
const EDITED = [
  [10, 54],
  [13, 55],
  [12, 56],
];

async function user(firstName: string): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `clr-${randomUUID().slice(0, 8)}`, passwordHash: "test-only", firstName },
  });
  users.push(u.id);
  return u.id;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.port.deleteMany({ where: { id: { in: portIds } } });
  await prisma.$disconnect();
});

async function cruiseOn(userId: string, tripId: string, withLine: boolean) {
  const tag = randomUUID().slice(0, 5).toUpperCase();
  const from = await prisma.port.create({
    data: { name: "Kiel", unlocode: `K${tag}`, lat: 54, lon: 10 },
  });
  const to = await prisma.port.create({
    data: { name: "Oslo", unlocode: `O${tag}`, lat: 56, lon: 12 },
  });
  portIds.push(from.id, to.id);
  const cruise = await prisma.cruise.create({
    data: {
      userId,
      tripId,
      departurePortId: from.id,
      arrivalPortId: to.id,
      stops: {
        create: [
          { dayNumber: 1, portId: from.id, position: 0 },
          { dayNumber: 2, portId: to.id, position: 1 },
        ],
      },
      legs: {
        create: [
          {
            ordinal: 0,
            fromPortId: from.id,
            toPortId: to.id,
            distanceKm: 400,
            method: "manual",
            routerVersion: "t",
          },
        ],
      },
    },
  });
  const addLine = (cruiseId: string, waypoints: number[][]) =>
    prisma.cruiseLegRoute.create({
      data: {
        cruiseId,
        fromKind: "port",
        fromRef: String(from.id),
        toKind: "port",
        toRef: String(to.id),
        waypoints,
      },
    });
  if (withLine) await addLine(cruise.id, LINE);
  return { cruise, addLine };
}

async function shared(withLine: boolean) {
  const anna = await user("Anna");
  const ben = await user("Ben");
  await prisma.shareConsent.create({
    data: { requesterId: anna, targetId: ben, status: "accepted" },
  });
  const trip = await prisma.trip.create({ data: { userId: anna, name: "Norwegen" } });
  const c = await cruiseOn(anna, trip.id, withLine);
  const { groupId } = await shareTripWithUser(anna, trip.id, ben);
  const benCruise = await prisma.cruise.findFirstOrThrow({
    where: { userId: ben, trip: { shareGroupId: groupId } },
  });
  return { anna, ben, ...c, benCruise };
}

const lineOf = async (cruiseId: string) =>
  (await prisma.cruiseLegRoute.findMany({ where: { cruiseId } })).map((r) => r.waypoints);

it("a shared cruise carries its hand-drawn line into the copy", async () => {
  const t = await shared(true);
  expect(await lineOf(t.benCruise.id)).toEqual([LINE]);
});

it("a redraw propagates to the copy", async () => {
  const t = await shared(true);
  await prisma.$transaction(async (tx) => {
    const before = await shareSnapshot(tx, "cruise", t.cruise.id);
    await tx.cruiseLegRoute.updateMany({
      where: { cruiseId: t.cruise.id },
      data: { waypoints: EDITED },
    });
    await propagateWrite(tx, t.anna, "cruise", t.cruise.id, before);
  });
  expect(await lineOf(t.benCruise.id)).toEqual([EDITED]);
});

it("the backfill gives a group shared before the line, and keeps a recipient's own line", async () => {
  const missing = await shared(false);
  await missing.addLine(missing.cruise.id, LINE);
  const own = await shared(false);
  await own.addLine(own.cruise.id, LINE);
  await own.addLine(own.benCruise.id, EDITED);

  const result = await backfillSharedCruiseRoutes({ apply: true });
  expect(await lineOf(missing.benCruise.id)).toEqual([LINE]);
  expect(await lineOf(own.benCruise.id)).toEqual([EDITED]);
  expect(result.kept).toBeGreaterThanOrEqual(1);
  const told = await prisma.shareNotice.findFirst({
    where: { userId: missing.ben, kind: "updated", entityType: "cruise" },
  });
  expect(told).not.toBeNull();
  // The kept line is said, not kept silently: Ben sees his line beside Anna's and decides.
  const conflict = await prisma.shareNotice.findFirst({
    where: { userId: own.ben, kind: "conflict", entityType: "cruise", undoneAt: null },
  });
  expect(conflict).not.toBeNull();
  expect(JSON.stringify(conflict!.after)).toContain("legRoutes");
  // A second run does not stack a second notice for the same open question.
  await backfillSharedCruiseRoutes({ apply: true });
  expect(
    await prisma.shareNotice.count({
      where: { userId: own.ben, kind: "conflict", entityType: "cruise", undoneAt: null },
    })
  ).toBe(1);
});
