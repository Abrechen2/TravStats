/**
 * Two ways a real cruise lost its shape on the way to another server (UAT 2026-11-27, RC ↔ Beta):
 *
 * - The owner's Yangtze cruise carries hand-drawn lines of up to 123 points. The wire allowed 64,
 *   so the receiver threw the whole message away as malformed: the trip could neither be linked
 *   nor shared, and the user read "the server does not answer".
 * - Nile ports (Esna, Edfu, Kom Ombo) are catalogue ports without a UN/LOCODE. The receiver
 *   matched ports by UN/LOCODE only, so the same seeded port on both servers arrived as an
 *   unresolved port call — and with it the legs and the hand-drawn line between them were gone.
 */
import { randomUUID } from "crypto";
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

/** Two catalogue ports on `s`, the same on both servers; `withCodes` decides the UN/LOCODE. */
async function ports(s: Server, tag: string, withCodes: boolean) {
  const p = (n: string, lat: number) =>
    s.prisma.port.create({
      data: {
        name: `River ${n} ${tag}`,
        unlocode: withCodes ? `Q${n}${tag}` : null,
        lat,
        lon: 32.6,
        country: "Egypt",
      },
    });
  const from = await p("U", 25.29);
  const to = await p("A", 24.98);
  made.set(s, [...(made.get(s) ?? []), from.id, to.id]);
  return { from, to };
}

/** A line from (25.29, 32.6) to (24.98, 32.6) with `count` points, every one distinct. */
function longLine(count: number): number[][] {
  return Array.from({ length: count }, (_, i) => {
    const f = i / (count - 1);
    return [32.6 + Math.sin(f * Math.PI) * 0.05, 25.29 - f * 0.31];
  });
}

async function sharedCruise(opts: {
  withCodes: boolean;
  line: number[][];
  twinOnB?: boolean;
  missingOnB?: boolean;
}) {
  const anna = await user(a, "Anna");
  const ben = await user(b, "Ben");
  const remote = await pairAcross(a, anna, b, ben);
  const tag = randomUUID().slice(0, 4).toUpperCase();
  const pa = await ports(a, tag, opts.withCodes);
  const pb = opts.missingOnB ? null : await ports(b, tag, opts.withCodes);
  if (opts.twinOnB) {
    const twin = await b.prisma.port.create({
      data: {
        name: pb!.from.name,
        unlocode: null,
        lat: pb!.from.lat,
        lon: pb!.from.lon,
        country: "Egypt",
      },
    });
    made.set(b, [...(made.get(b) ?? []), twin.id]);
  }
  const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Nil 2022" } });
  const cruise = await a.prisma.cruise.create({
    data: {
      userId: anna,
      tripId: trip.id,
      routeName: "Nile",
      departurePortId: pa.from.id,
      arrivalPortId: pa.to.id,
      startDate: new Date("2022-10-28T00:00:00.000Z"),
      endDate: new Date("2022-10-30T00:00:00.000Z"),
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
            distanceKm: 40,
            method: "manual",
            routerVersion: "t",
            confidence: "high",
          },
        ],
      },
    },
  });
  await a.prisma.cruiseLegRoute.create({
    data: {
      cruiseId: cruise.id,
      fromKind: "port",
      fromRef: String(pa.from.id),
      toKind: "port",
      toRef: String(pa.to.id),
      waypoints: opts.line,
    },
  });
  const benTrip = await offerAndAccept(a, anna, trip.id, remote.id, b, ben);
  const benCruise = await b.prisma.cruise.findFirstOrThrow({
    where: { tripId: benTrip },
    include: { stops: { orderBy: { position: "asc" } }, legs: true },
  });
  const lines = await b.prisma.cruiseLegRoute.findMany({ where: { cruiseId: benCruise.id } });
  return { pa, pb: pb!, benCruise, lines };
}

it("a hand-drawn line of more than 64 points no longer breaks the share: it arrives thinned, ends kept", async () => {
  const line = longLine(123);
  const t = await sharedCruise({ withCodes: true, line });
  expect(t.benCruise.stops.map((s) => s.portId)).toEqual([t.pb.from.id, t.pb.to.id]);
  expect(t.lines).toHaveLength(1);
  const got = t.lines[0].waypoints as number[][];
  expect(got.length).toBeLessThanOrEqual(64);
  expect(got.length).toBeGreaterThan(2);
  expect(got[0]).toEqual(line[0]);
  expect(got[got.length - 1]).toEqual(line[line.length - 1]);
});

it("catalogue ports without a UN/LOCODE resolve on the receiver by name, country and position", async () => {
  const line = longLine(5);
  const t = await sharedCruise({ withCodes: false, line });
  expect(t.benCruise.stops.map((s) => [s.portId, s.unresolvedPortName])).toEqual([
    [t.pb.from.id, null],
    [t.pb.to.id, null],
  ]);
  expect(t.benCruise.legs.map((l) => [l.fromPortId, l.toPortId])).toEqual([
    [t.pb.from.id, t.pb.to.id],
  ]);
  expect(t.lines.map((l) => [l.fromRef, l.toRef, l.waypoints])).toEqual([
    [String(t.pb.from.id), String(t.pb.to.id), line],
  ]);
});

it("two catalogue ports of one name at one place on the receiver are not guessed between", async () => {
  const t = await sharedCruise({ withCodes: false, line: longLine(5), twinOnB: true });
  expect(t.benCruise.stops.map((s) => [s.portId, s.unresolvedPortName])).toEqual([
    [null, t.pb.from.name],
    [t.pb.to.id, null],
  ]);
});

/**
 * Sharing UAT 2: the owner's Yangtze ports (Fengdu, Wushan, …) are his own additions, unknown to
 * his father's catalogue. Every leg and the drawn line of more than 64 points were dropped without
 * a word. The receiver now adds such ports as user ports and keeps the cruise's shape.
 */
it("ports the receiver lacks entirely arrive as user ports, with the legs and the line", async () => {
  const line = longLine(5);
  const t = await sharedCruise({ withCodes: false, line, missingOnB: true });
  const ids = t.benCruise.stops.map((s) => s.portId);
  expect(ids.every((id) => id !== null)).toBe(true);
  expect(t.benCruise.stops.map((s) => s.unresolvedPortName)).toEqual([null, null]);
  const added = await b.prisma.port.findMany({ where: { id: { in: ids as number[] } } });
  made.set(b, [...(made.get(b) ?? []), ...added.map((p) => p.id)]);
  expect(added.map((p) => [p.name, p.isUserAdded, p.country]).sort()).toEqual(
    [
      [t.pa.from.name, true, "Egypt"],
      [t.pa.to.name, true, "Egypt"],
    ].sort()
  );
  expect(t.benCruise.legs.map((l) => [l.fromPortId, l.toPortId])).toEqual([[ids[0], ids[1]]]);
  expect(t.lines.map((l) => l.waypoints)).toEqual([line]);
});
