/**
 * Hand-drawn cruise lines travel with a share (2026-11-24). Measured on prod: the owner's cruise
 * had one cruise_leg_routes row with 18 waypoints; his father's copy on another server had the
 * same 15 stops and no line, because nothing under services/sharing read that table.
 */
import { randomUUID } from "crypto";
import { backfillSharedCruiseRoutes } from "../../backfillCruiseRoutes";
import { offerAndAccept, pairAcross } from "./sharedTripFixtures";
import { servers, user, useTwoServers, type Server } from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const made = new Map<Server, number[]>();
afterAll(async () => {
  for (const [s, ids] of made) {
    await s.prisma.cruise.deleteMany({ where: { departurePortId: { in: ids } } });
    await s.prisma.port.deleteMany({ where: { id: { in: ids } } });
  }
});

/** Two ports on `s` with the same UN/LOCODEs on both servers (different ids per server). */
async function ports(s: Server, tag: string) {
  const p = (n: string, lat: number) =>
    s.prisma.port.create({
      data: { name: `Port ${n}`, unlocode: `Q${n}${tag}`, lat, lon: -60, country: "AR" },
    });
  const from = await p("U", -54.8);
  const to = await p("A", -62.0);
  made.set(s, [...(made.get(s) ?? []), from.id, to.id]);
  return { from, to };
}

const LINE = [
  [-60, -54.8],
  [-61, -57],
  [-60, -62],
];
const EDITED = [
  [-60, -54.8],
  [-63, -58],
  [-60, -62],
];

async function sharedCruise(withLineBeforeShare: boolean) {
  const anna = await user(a, "Anna");
  const ben = await user(b, "Ben");
  const remote = await pairAcross(a, anna, b, ben);
  const tag = randomUUID().slice(0, 4).toUpperCase();
  const pa = await ports(a, tag);
  const pb = await ports(b, tag);
  const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Antarktis 2027" } });
  const cruise = await a.prisma.cruise.create({
    data: {
      userId: anna,
      tripId: trip.id,
      routeName: "Antarctica",
      departurePortId: pa.from.id,
      arrivalPortId: pa.to.id,
      startDate: new Date("2027-01-10T00:00:00.000Z"),
      endDate: new Date("2027-01-12T00:00:00.000Z"),
      stops: {
        create: [
          { dayNumber: 1, portId: pa.from.id, position: 0 },
          { dayNumber: 3, portId: pa.to.id, position: 1 },
        ],
      },
      legs: {
        create: [
          {
            ordinal: 0,
            fromPortId: pa.from.id,
            toPortId: pa.to.id,
            distanceKm: 900,
            method: "manual",
            routerVersion: "t",
            confidence: "high",
          },
        ],
      },
    },
  });
  const addLine = (cruiseId: string, waypoints: number[][], s: Server, from: number, to: number) =>
    s.prisma.cruiseLegRoute.create({
      data: {
        cruiseId,
        fromKind: "port",
        fromRef: String(from),
        toKind: "port",
        toRef: String(to),
        waypoints,
      },
    });
  if (withLineBeforeShare) await addLine(cruise.id, LINE, a, pa.from.id, pa.to.id);
  const benTrip = await offerAndAccept(a, anna, trip.id, remote.id, b, ben);
  const benCruise = await b.prisma.cruise.findFirstOrThrow({ where: { tripId: benTrip } });
  return { anna, ben, trip, cruise, benCruise, pa, pb, addLine };
}

const linesOn = (s: Server, cruiseId: string) =>
  s.prisma.cruiseLegRoute.findMany({
    where: { cruiseId },
    select: { fromRef: true, toRef: true, waypoints: true },
  });

/** Anna redraws the line through the write path the editor uses (snapshot, write, propagate). */
async function redraw(s: Server, userId: string, cruiseId: string, waypoints: number[][]) {
  await s.prisma.$transaction(async (tx) => {
    const before = await s.propagate.shareSnapshot(tx, "cruise", cruiseId);
    await tx.cruiseLegRoute.updateMany({ where: { cruiseId }, data: { waypoints } });
    await s.propagate.propagateWrite(tx, userId, "cruise", cruiseId, before);
  });
  await s.outbox.runDeliveries();
}

it("a cruise's hand-drawn line reaches the recipient on another server, on that server's ports", async () => {
  const t = await sharedCruise(true);
  expect(await linesOn(b, t.benCruise.id)).toEqual([
    { fromRef: String(t.pb.from.id), toRef: String(t.pb.to.id), waypoints: LINE },
  ]);
});

it("a later redraw propagates to the recipient's copy", async () => {
  const t = await sharedCruise(true);
  await redraw(a, t.anna, t.cruise.id, EDITED);
  expect((await linesOn(b, t.benCruise.id)).map((l) => l.waypoints)).toEqual([EDITED]);
});

it("the recipient's own line is kept and flagged as a conflict, never overwritten silently", async () => {
  const t = await sharedCruise(true);
  // Ben's own drawing, not yet on its way to the home.
  await b.prisma.cruiseLegRoute.updateMany({
    where: { cruiseId: t.benCruise.id },
    data: {
      waypoints: [
        [-60, -54.8],
        [-59, -59],
        [-60, -62],
      ],
    },
  });
  await redraw(a, t.anna, t.cruise.id, EDITED);
  expect((await linesOn(b, t.benCruise.id)).map((l) => l.waypoints)).toEqual([
    [
      [-60, -54.8],
      [-59, -59],
      [-60, -62],
    ],
  ]);
  const conflicts = await b.notices.listNotices(t.ben);
  expect(conflicts.some((n) => n.kind === "conflict" && n.entityType === "cruise")).toBe(true);
});

it("a server from before the lines still gets the rest of the change", async () => {
  const t = await sharedCruise(true);
  const spy = jest.spyOn(b.peerFeatures, "servedFeatures").mockReturnValue([]);
  a.peerFeatures.forgetPeerFeatures();
  try {
    await a.prisma.$transaction(async (tx) => {
      const before = await a.propagate.shareSnapshot(tx, "cruise", t.cruise.id);
      await tx.cruiseLegRoute.updateMany({
        where: { cruiseId: t.cruise.id },
        data: { waypoints: EDITED },
      });
      await tx.cruise.update({ where: { id: t.cruise.id }, data: { routeName: "Antarktis" } });
      await a.propagate.propagateWrite(tx, t.anna, "cruise", t.cruise.id, before);
    });
    await a.outbox.runDeliveries();
    const copy = await b.prisma.cruise.findUniqueOrThrow({ where: { id: t.benCruise.id } });
    expect(copy.routeName).toBe("Antarktis");
    // The line was not sent: a server from before would refuse the whole message over it.
    expect((await linesOn(b, t.benCruise.id)).map((l) => l.waypoints)).toEqual([LINE]);
    expect(await a.prisma.tripShareOutbox.count({ where: { parkedAt: { not: null } } })).toBe(0);
  } finally {
    spy.mockRestore();
    a.peerFeatures.forgetPeerFeatures();
  }
});

it("a group shared before the lines travelled gets them through the one-off backfill", async () => {
  const t = await sharedCruise(false);
  // Drawn before the deploy: written then without the line being a fact.
  await t.addLine(t.cruise.id, LINE, a, t.pa.from.id, t.pa.to.id);
  expect(await linesOn(b, t.benCruise.id)).toEqual([]);
  const dry = await backfillSharedCruiseRoutes({ apply: false });
  expect(dry.queued).toBeGreaterThanOrEqual(1);
  const { shareGroupId } = await a.prisma.trip.findUniqueOrThrow({ where: { id: t.trip.id } });
  expect(await a.prisma.tripShareOutbox.count({ where: { groupId: shareGroupId ?? "" } })).toBe(0);
  await backfillSharedCruiseRoutes({ apply: true });
  await a.outbox.runDeliveries();
  expect((await linesOn(b, t.benCruise.id)).map((l) => l.waypoints)).toEqual([LINE]);
});
