import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { recomputeLegsForCruise } from "../cruiseLegService";
import { polylineDistanceKm } from "../polylineDistance";

// A deliberate detour: far longer than any sensible route between the two
// ports, so a distance that came from the router is unmistakable.
const DETOUR: Array<[number, number]> = [
  [9.99, 53.55],
  [-30.0, 50.0],
  [-30.0, 20.0],
  [-9.14, 38.72],
];

describe("recomputeLegsForCruise with a hand-drawn route", () => {
  let userId: string;
  let cruiseId: string;
  let fromPortId: number;
  let midPortId: number;
  let toPortId: number;

  // Itinerary is departure(fromPortId) -> stop(midPortId) -> arrival(toPortId),
  // i.e. two legs: ordinal 0 (from -> mid) and ordinal 1 (mid -> to). This is
  // deliberate — a fixture with a single leg cannot distinguish "override
  // attaches to one specific leg" from "override applies cruise-wide", which
  // is the stage's headline design decision.
  const legRow = async (ordinal: number) =>
    prisma.cruiseLeg.findFirst({ where: { cruiseId, ordinal } });

  const writeOverride = async (fromRef: number, toRef: number, waypoints: Array<[number, number]>) =>
    prisma.cruiseLegRoute.create({
      data: {
        cruiseId,
        fromKind: "port",
        fromRef: String(fromRef),
        toKind: "port",
        toRef: String(toRef),
        waypoints,
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "legoverride" } });
    const u = await prisma.user.create({
      data: { username: "legoverride", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;

    const ports = await prisma.port.findMany({ where: { isUserAdded: false }, take: 3 });
    if (ports.length < 3) throw new Error("need three seeded ports — run the port seeder first");
    fromPortId = ports[0].id;
    midPortId = ports[1].id;
    toPortId = ports[2].id;

    const c = await prisma.cruise.create({
      data: {
        userId,
        departurePortId: fromPortId,
        arrivalPortId: toPortId,
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-08"),
        status: "scheduled",
        stops: {
          create: [{ portId: midPortId, dayNumber: 3, isAtSea: false }],
        },
      },
    });
    cruiseId = c.id;
  });

  afterEach(async () => {
    await prisma.cruiseLegRoute.deleteMany({ where: { cruiseId } });
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("uses the router when there is no override", async () => {
    await recomputeLegsForCruise(cruiseId);
    const leg = await legRow(0);
    expect(leg).not.toBeNull();
    expect(leg?.method).not.toBe("manual_polyline");
  });

  it("uses the drawn line's length when there is one", async () => {
    await writeOverride(fromPortId, midPortId, DETOUR);
    await recomputeLegsForCruise(cruiseId);
    const leg = await legRow(0);
    expect(leg?.method).toBe("manual_polyline");
    expect(leg?.distanceKm).toBeCloseTo(polylineDistanceKm(DETOUR), 2);
  });

  it("keeps the drawn line across repeated recomputes — the version-bump invariant", async () => {
    await writeOverride(fromPortId, midPortId, DETOUR);
    await recomputeLegsForCruise(cruiseId);
    const first = await legRow(0);

    // This is what a routerVersion / ORCHESTRATOR_VERSION bump does. It must
    // not quietly return the kilometres to the router's value while the map
    // still shows the user's line.
    await recomputeLegsForCruise(cruiseId);
    await recomputeLegsForCruise(cruiseId);

    const third = await legRow(0);
    expect(third?.distanceKm).toBeCloseTo(first?.distanceKm ?? -1, 6);
    expect(third?.method).toBe("manual_polyline");
    expect(await prisma.cruiseLegRoute.count({ where: { cruiseId } })).toBe(1);
  });

  it("returns to the router once the override is gone", async () => {
    await writeOverride(fromPortId, midPortId, DETOUR);
    await recomputeLegsForCruise(cruiseId);
    expect((await legRow(0))?.method).toBe("manual_polyline");

    await prisma.cruiseLegRoute.deleteMany({ where: { cruiseId } });
    await recomputeLegsForCruise(cruiseId);
    expect((await legRow(0))?.method).not.toBe("manual_polyline");
  });

  it("ignores an override whose endpoints match no leg", async () => {
    await prisma.cruiseLegRoute.create({
      data: {
        cruiseId,
        fromKind: "port",
        fromRef: String(toPortId),
        toKind: "port",
        toRef: String(fromPortId),
        waypoints: DETOUR,
      },
    });
    await recomputeLegsForCruise(cruiseId);
    expect((await legRow(0))?.method).not.toBe("manual_polyline");
  });

  it("discriminates between the two legs — override on the first leg only", async () => {
    await writeOverride(fromPortId, midPortId, DETOUR);
    await recomputeLegsForCruise(cruiseId);

    const leg0 = await legRow(0);
    const leg1 = await legRow(1);
    expect(leg0?.method).toBe("manual_polyline");
    expect(leg0?.distanceKm).toBeCloseTo(polylineDistanceKm(DETOUR), 2);
    expect(leg1?.method).not.toBe("manual_polyline");
  });

  it("discriminates between the two legs — override on the second leg only", async () => {
    await writeOverride(midPortId, toPortId, DETOUR);
    await recomputeLegsForCruise(cruiseId);

    const leg0 = await legRow(0);
    const leg1 = await legRow(1);
    expect(leg0?.method).not.toBe("manual_polyline");
    expect(leg1?.method).toBe("manual_polyline");
    expect(leg1?.distanceKm).toBeCloseTo(polylineDistanceKm(DETOUR), 2);
  });
});
