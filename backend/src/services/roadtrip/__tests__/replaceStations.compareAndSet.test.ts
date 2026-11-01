import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { replaceStations, type Station } from "../replaceStations";

let userId: string;
let routeId: string;
beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { username: "cas-" + randomUUID(), passwordHash: "x" } })
  ).id;
  routeId = (
    await prisma.tripRoute.create({ data: { userId, kind: "roadtrip", name: "cas", mode: "road" } })
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

describe("replaceStations compare-and-set on the stops it replaces", () => {
  it("refuses a list built from a stop that was edited meanwhile instead of overwriting the edit (409 ROADTRIP_STATIONS_CHANGED)", async () => {
    const first = await replaceStations(userId, routeId, [station("A", 50), station("B", 51)]);
    const [a, b] = first.stations;
    const read = new Map([a, b].map((s) => [s.id, s.title] as const));
    // The phone renames B after the writer read it.
    await prisma.tripStop.update({ where: { id: b.id }, data: { title: "B (phone)" } });
    await expect(
      replaceStations(
        userId,
        routeId,
        [station("A", 50, a.id), station("B", 51, b.id), station("C", 52)],
        { expectedVersions: { version: (r) => r.title, expected: read } }
      )
    ).rejects.toMatchObject({ statusCode: 409, code: "ROADTRIP_STATIONS_CHANGED" });
    const after = await prisma.tripStop.findMany({
      where: { routeId },
      orderBy: { routeOrderIdx: "asc" },
    });
    expect(after.map((s) => s.title)).toEqual(["A", "B (phone)"]);
  });
});
