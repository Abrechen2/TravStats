import { prisma } from "../../../../db";
import { commitPlaceImport } from "../../placeImportCommit";
import {
  listImportBatchItems,
  listImportBatches,
  revertImportBatch,
} from "../../../importBatchService";

/**
 * Trip stops written by a Takeout import belong to its batch (fix/ct142-places):
 * without the link, "undo this import" left every stop behind, and an import
 * that wrote only stops never appeared in the import log at all.
 */
describe("Takeout trip stops and the import batch", () => {
  let userId: string;
  let tripId: string;

  const stopRow = (i: number, lat: number) => ({
    sourceRowIndex: i,
    name: `Invented Stop ${i}`,
    lat,
    lon: 10.466,
    visitedAt: "2024-07-12",
    treatment: "trip_stop" as const,
    tripId,
  });

  beforeEach(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `takeout-batch-${Date.now()}-${Math.random()}`, passwordHash: "x" },
      })
    ).id;
    tripId = (await prisma.trip.create({ data: { userId, name: "Norway" } })).id;
  });

  afterEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.importBatch.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("shows a stop-only import in the log, with its stops", async () => {
    const result = await commitPlaceImport(userId, "csv", "Norwegen.csv", [
      stopRow(0, 61.1),
      stopRow(1, 61.2),
    ]);
    expect(result.stops).toBe(2);
    const batches = await listImportBatches(userId);
    expect(batches.map((b) => b.id)).toEqual([result.batchId]);
    expect(batches[0].counts.stops).toBe(2);
    const items = await listImportBatchItems(userId, result.batchId);
    expect(items.total).toBe(2);
    expect(items.items.map((i) => [i.kind, i.label]).sort()).toEqual([
      ["stop", "Invented Stop 0"],
      ["stop", "Invented Stop 1"],
    ]);
  });

  it("takes the stops back on undo and leaves the trip's own stops alone", async () => {
    await prisma.tripStop.create({ data: { tripId, title: "Typed by hand", orderIdx: 0 } });
    const result = await commitPlaceImport(userId, "csv", "Norwegen.csv", [stopRow(0, 61.1)]);
    const reverted = await revertImportBatch(userId, result.batchId);
    expect(reverted.deleted).toBe(1);
    const left = await prisma.tripStop.findMany({ where: { tripId }, select: { title: true } });
    expect(left.map((s) => s.title)).toEqual(["Typed by hand"]);
  });
});
