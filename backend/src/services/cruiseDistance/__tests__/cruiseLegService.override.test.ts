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
  let toPortId: number;

  const legRow = async () =>
    prisma.cruiseLeg.findFirst({ where: { cruiseId }, orderBy: { ordinal: "asc" } });

  const writeOverride = async (waypoints: Array<[number, number]>) =>
    prisma.cruiseLegRoute.create({
      data: {
        cruiseId,
        fromKind: "port",
        fromRef: String(fromPortId),
        toKind: "port",
        toRef: String(toPortId),
        waypoints,
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "legoverride" } });
    const u = await prisma.user.create({
      data: { username: "legoverride", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;

    const ports = await prisma.port.findMany({ where: { isUserAdded: false }, take: 2 });
    if (ports.length < 2) throw new Error("need two seeded ports — run the port seeder first");
    fromPortId = ports[0].id;
    toPortId = ports[1].id;

    const c = await prisma.cruise.create({
      data: {
        userId,
        departurePortId: fromPortId,
        arrivalPortId: toPortId,
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-08"),
        status: "scheduled",
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
    const leg = await legRow();
    expect(leg).not.toBeNull();
    expect(leg?.method).not.toBe("manual_polyline");
  });

  it("uses the drawn line's length when there is one", async () => {
    await writeOverride(DETOUR);
    await recomputeLegsForCruise(cruiseId);
    const leg = await legRow();
    expect(leg?.method).toBe("manual_polyline");
    expect(leg?.distanceKm).toBeCloseTo(polylineDistanceKm(DETOUR), 2);
  });

  it("keeps the drawn line across repeated recomputes — the version-bump invariant", async () => {
    await writeOverride(DETOUR);
    await recomputeLegsForCruise(cruiseId);
    const first = await legRow();

    // This is what a routerVersion / ORCHESTRATOR_VERSION bump does. It must
    // not quietly return the kilometres to the router's value while the map
    // still shows the user's line.
    await recomputeLegsForCruise(cruiseId);
    await recomputeLegsForCruise(cruiseId);

    const third = await legRow();
    expect(third?.distanceKm).toBeCloseTo(first?.distanceKm ?? -1, 6);
    expect(third?.method).toBe("manual_polyline");
    expect(await prisma.cruiseLegRoute.count({ where: { cruiseId } })).toBe(1);
  });

  it("returns to the router once the override is gone", async () => {
    await writeOverride(DETOUR);
    await recomputeLegsForCruise(cruiseId);
    expect((await legRow())?.method).toBe("manual_polyline");

    await prisma.cruiseLegRoute.deleteMany({ where: { cruiseId } });
    await recomputeLegsForCruise(cruiseId);
    expect((await legRow())?.method).not.toBe("manual_polyline");
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
    expect((await legRow())?.method).not.toBe("manual_polyline");
  });
});
