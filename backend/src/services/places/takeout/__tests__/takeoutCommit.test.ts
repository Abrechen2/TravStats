import { prisma } from "../../../../db";
import { commitPlaceImport } from "../../placeImportCommit";

/**
 * #358 point 4, the write side: what the user picked per row in the preview —
 * a place (with its trip), a trip stop, or "this is my stay" — and a trip or
 * stay that is not theirs refused per row, never dropped.
 */
describe("place import commit: Takeout treatments", () => {
  let userId: string;
  let otherId: string;
  let tripId: string;

  beforeEach(async () => {
    const make = (tag: string) =>
      prisma.user.create({
        data: {
          username: `takeout-commit-${tag}-${Date.now()}-${Math.random()}`,
          passwordHash: "x",
        },
      });
    userId = (await make("a")).id;
    otherId = (await make("b")).id;
    tripId = (await prisma.trip.create({ data: { userId, name: "Norway", countries: ["NO"] } })).id;
  });

  afterEach(async () => {
    for (const id of [userId, otherId]) {
      await prisma.place.deleteMany({ where: { userId: id } });
      await prisma.lodgingStay.deleteMany({ where: { userId: id } });
      await prisma.lodging.deleteMany({ where: { userId: id } });
      await prisma.trip.deleteMany({ where: { userId: id } });
      await prisma.importBatch.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });

  it("writes a fuel stop as a stop on the trip, dated and appended", async () => {
    await prisma.tripStop.create({ data: { tripId, title: "Existing", orderIdx: 4 } });

    const result = await commitPlaceImport(userId, "csv", "Norwegen.csv", [
      {
        sourceRowIndex: 0,
        name: "Invented Fuel Stop",
        lat: 61.115,
        lon: 10.466,
        visitedAt: "2024-07-12",
        treatment: "trip_stop",
        tripId,
      },
    ]);

    expect(result).toMatchObject({ created: 0, stops: 1, matchedStays: 0, failed: [] });
    const stop = await prisma.tripStop.findFirst({
      where: { tripId, title: "Invented Fuel Stop" },
    });
    expect(stop).toMatchObject({ lat: 61.115, lon: 10.466, orderIdx: 5 });
    expect(stop?.startDate?.toISOString().slice(0, 10)).toBe("2024-07-12");
    expect(await prisma.place.count({ where: { userId } })).toBe(0);
  });

  it("confirms a stay as the user's without writing anything", async () => {
    const lodging = await prisma.lodging.create({ data: { userId, name: "Invented Hotel" } });
    const stay = await prisma.lodgingStay.create({
      data: { userId, lodgingId: lodging.id, tripId },
    });

    const result = await commitPlaceImport(userId, "csv", null, [
      { sourceRowIndex: 0, name: "Invented Hotel", treatment: "stay", lodgingStayId: stay.id },
    ]);

    expect(result).toMatchObject({ created: 0, stops: 0, matchedStays: 1, failed: [] });
    expect(await prisma.place.count({ where: { userId } })).toBe(0);
  });

  it("gives a dated place's visit the trip the preview suggested", async () => {
    const result = await commitPlaceImport(userId, "csv", null, [
      {
        sourceRowIndex: 0,
        name: "Invented Viewpoint",
        lat: 58.986,
        lon: 6.19,
        visitedAt: "2024-07-10",
        tripId,
      },
    ]);

    expect(result.created).toBe(1);
    const visit = await prisma.placeVisit.findFirst({ where: { userId } });
    expect(visit?.tripId).toBe(tripId);
  });

  it("refuses a trip or a stay that belongs to someone else, row by row", async () => {
    const foreignTrip = await prisma.trip.create({ data: { userId: otherId, name: "Theirs" } });
    const lodging = await prisma.lodging.create({ data: { userId: otherId, name: "Theirs" } });
    const foreignStay = await prisma.lodgingStay.create({
      data: { userId: otherId, lodgingId: lodging.id },
    });

    const result = await commitPlaceImport(userId, "csv", null, [
      {
        sourceRowIndex: 0,
        name: "A",
        lat: 1,
        lon: 1,
        treatment: "trip_stop",
        tripId: foreignTrip.id,
      },
      { sourceRowIndex: 1, name: "B", treatment: "stay", lodgingStayId: foreignStay.id },
      {
        sourceRowIndex: 2,
        name: "C",
        lat: 1,
        lon: 1,
        visitedAt: "2024-01-01",
        tripId: foreignTrip.id,
      },
      { sourceRowIndex: 3, name: "D", lat: 2, lon: 2 },
    ]);

    expect(result.created).toBe(1);
    expect(result.failed.map((f) => [f.sourceRowIndex, f.code])).toEqual([
      [0, "invalid_target"],
      [1, "invalid_target"],
      [2, "invalid_target"],
    ]);
    expect(await prisma.tripStop.count({ where: { tripId: foreignTrip.id } })).toBe(0);
  });
});
