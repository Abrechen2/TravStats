import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { replaceStations, type Station } from "../replaceStations";

jest.mock("../../tour/routing/resolveProvider", () => ({
  ...jest.requireActual("../../tour/routing/resolveProvider"),
  resolveRouteProvider: jest.fn(async () => null),
}));

let userId: string;
let routeId: string;
beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { username: "mv-" + randomUUID(), passwordHash: "x" } })
  ).id;
  routeId = (
    await prisma.tripRoute.create({ data: { userId, kind: "roadtrip", name: "mv", mode: "road" } })
  ).id;
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

const station = (title: string, lat: number, id?: string): Station => ({
  ...(id ? { id } : {}),
  title,
  lat,
  lon: 10,
  night: { kind: "pass", placeId: null },
});

describe("replaceStations with a station that moved (#410)", () => {
  it("drops the old routed line of a moved station so the dashboard does not keep drawing the old route", async () => {
    const first = await replaceStations(userId, routeId, [station("A", 50), station("B", 51)]);
    const [a, b] = first.stations;
    const oldLine = [
      [10, 50],
      [10.5, 50.5],
      [10, 51],
    ];
    await prisma.tripRouteLeg.updateMany({
      where: { routeId },
      data: { source: "routed", confidence: "high", waypoints: oldLine, drivingMinutes: 70 },
    });

    // The user moves B by hand and saves the list.
    await replaceStations(userId, routeId, [station("A", 50, a.id), station("B", 52, b.id)]);

    const legs = await prisma.tripRouteLeg.findMany({ where: { routeId } });
    expect(legs).toHaveLength(1);
    expect(legs[0].waypoints).toBeNull();
    expect(legs[0].source).toBe("straight");
    expect(legs[0].drivingMinutes).toBeNull();
    expect(legs[0].distanceKm).toBeGreaterThan(200);
  });

  it("keeps a line the user drew when its station moves, only lowering its confidence", async () => {
    const now = await prisma.tripStop.findMany({
      where: { routeId },
      orderBy: { routeOrderIdx: "asc" },
    });
    const drawn = [
      [10, 50],
      [10, 52],
    ];
    await prisma.tripRouteLeg.updateMany({
      where: { routeId },
      data: { source: "drawn", confidence: "high", waypoints: drawn },
    });
    await replaceStations(userId, routeId, [
      station("A", 50, now[0].id),
      station("B", 53, now[1].id),
    ]);
    const [leg] = await prisma.tripRouteLeg.findMany({ where: { routeId } });
    expect(leg.source).toBe("drawn");
    expect(leg.waypoints).toEqual(drawn);
    expect(leg.confidence).toBe("low");
  });
});
