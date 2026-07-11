import { prisma } from "../db";
import { commitLodgingImport } from "../services/lodging/lodgingImportCommit";
import {
  listLodgingImportBatches,
  revertLodgingImportBatch,
} from "../services/lodging/lodgingImportBatches";
import type { CommitRowInput } from "../schemas/lodgingImport";

jest.mock("../services/fx/frankfurter", () => ({
  convertToBase: jest.fn(async (amount: number) => ({
    baseAmount: amount,
    rate: 1,
    rateDate: "2026-01-01",
  })),
  getRate: jest.fn(async () => 1),
}));

describe("lodging import batches", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "lodging-import-batches-test", passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("lists batches with their row counts", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Batch List Hotel" },
        stay: { checkIn: "2026-01-01", checkOut: "2026-01-02" },
      },
    ];
    const { batchId } = await commitLodgingImport(userId, "csv", "list.csv", rows);

    const batches = await listLodgingImportBatches(userId);
    const found = batches.find((b) => b.id === batchId);
    expect(found).toBeDefined();
    expect(found?.source).toBe("csv");
    expect(found?.fileName).toBe("list.csv");
    expect(found?.lodgingCount).toBe(1);
    expect(found?.stayCount).toBe(1);
  });

  it("reverts a batch: its rows are gone, pre-existing rows survive", async () => {
    const preExisting = await prisma.lodging.create({ data: { userId, name: "Survivor Hotel" } });

    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Revert Me Hotel" },
        stay: { checkIn: "2026-02-01", checkOut: "2026-02-03" },
      },
      {
        // a stay added to a lodging that already existed BEFORE the import:
        // the stay must go, the lodging must stay.
        sourceRowIndex: 1,
        action: "create",
        matchedLodgingId: preExisting.id,
        lodging: null,
        stay: { checkIn: "2026-02-10", checkOut: "2026-02-11" },
      },
    ];
    const { batchId } = await commitLodgingImport(userId, "csv", "revert.csv", rows);

    const result = await revertLodgingImportBatch(userId, batchId);
    expect(result.deletedLodgings).toBe(1);
    expect(result.deletedStays).toBe(2);
    expect(result.detachedLodgings).toBe(0);

    expect(
      await prisma.lodging.findFirst({ where: { userId, name: "Revert Me Hotel" } }),
    ).toBeNull();
    expect(await prisma.lodging.findUnique({ where: { id: preExisting.id } })).not.toBeNull();
    expect(await prisma.lodgingStay.count({ where: { lodgingId: preExisting.id } })).toBe(0);
    expect(await prisma.lodgingImportBatch.findUnique({ where: { id: batchId } })).toBeNull();

    await prisma.lodging.delete({ where: { id: preExisting.id } });
  });

  it("keeps a hand-added stay: its batch-created lodging survives, detached (batchId null)", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Hand Made Survivor Hotel" },
        stay: { checkIn: "2026-03-01", checkOut: "2026-03-02" },
      },
    ];
    const { batchId } = await commitLodgingImport(userId, "csv", "handmade.csv", rows);

    const lodging = await prisma.lodging.findFirst({
      where: { userId, name: "Hand Made Survivor Hotel" },
    });
    if (!lodging) throw new Error("test setup failed: lodging was not created");

    // The user adds a stay by hand afterwards — not part of any import batch.
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2026-04-01T00:00:00.000Z"),
        checkOut: new Date("2026-04-02T00:00:00.000Z"),
      },
    });

    const result = await revertLodgingImportBatch(userId, batchId);
    expect(result.deletedStays).toBe(1); // only the batch's own stay
    expect(result.deletedLodgings).toBe(0);
    expect(result.detachedLodgings).toBe(1);

    const survivor = await prisma.lodging.findUnique({ where: { id: lodging.id } });
    expect(survivor).not.toBeNull();
    expect(survivor?.batchId).toBeNull();
    expect(await prisma.lodgingStay.count({ where: { lodgingId: lodging.id } })).toBe(1);

    await prisma.lodgingStay.deleteMany({ where: { lodgingId: lodging.id } });
    await prisma.lodging.delete({ where: { id: lodging.id } });
  });

  it("keeps a lodging alive across batches: reverting its creator does not touch a later batch's stay", async () => {
    const rowsA: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Cross Batch Hotel" },
        stay: { checkIn: "2026-05-01", checkOut: "2026-05-02" },
      },
    ];
    const { batchId: batchAId } = await commitLodgingImport(userId, "csv", "batchA.csv", rowsA);

    const lodging = await prisma.lodging.findFirst({
      where: { userId, name: "Cross Batch Hotel" },
    });
    if (!lodging) throw new Error("test setup failed: lodging was not created");

    const rowsB: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        matchedLodgingId: lodging.id,
        lodging: null,
        stay: { checkIn: "2026-06-01", checkOut: "2026-06-02" },
      },
    ];
    const { batchId: batchBId } = await commitLodgingImport(userId, "csv", "batchB.csv", rowsB);

    // Reverting batch A must not cascade-delete batch B's stay along with the
    // lodging it lives on.
    const resultA = await revertLodgingImportBatch(userId, batchAId);
    expect(resultA.deletedStays).toBe(1);
    expect(resultA.deletedLodgings).toBe(0);
    expect(resultA.detachedLodgings).toBe(1);

    const detached = await prisma.lodging.findUnique({ where: { id: lodging.id } });
    expect(detached).not.toBeNull();
    expect(detached?.batchId).toBeNull();
    expect(await prisma.lodgingStay.count({ where: { lodgingId: lodging.id } })).toBe(1);

    // Batch B is untouched and still listable.
    const batches = await listLodgingImportBatches(userId);
    expect(batches.find((b) => b.id === batchBId)).toBeDefined();

    // Batch B still reverts correctly afterwards: it owns the stay but not
    // the (already detached) lodging.
    const resultB = await revertLodgingImportBatch(userId, batchBId);
    expect(resultB.deletedStays).toBe(1);
    expect(resultB.deletedLodgings).toBe(0);
    expect(resultB.detachedLodgings).toBe(0);

    const afterB = await prisma.lodging.findUnique({ where: { id: lodging.id } });
    expect(afterB).not.toBeNull();
    expect(await prisma.lodgingStay.count({ where: { lodgingId: lodging.id } })).toBe(0);

    await prisma.lodging.delete({ where: { id: lodging.id } });
  });

  it("deletes a batch-created lodging when all its stays came from that batch (happy path)", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Fully Reverted Hotel" },
        stay: { checkIn: "2026-07-01", checkOut: "2026-07-02" },
      },
    ];
    const { batchId } = await commitLodgingImport(userId, "csv", "fullyreverted.csv", rows);

    const result = await revertLodgingImportBatch(userId, batchId);
    expect(result.deletedLodgings).toBe(1);
    expect(result.deletedStays).toBe(1);
    expect(result.detachedLodgings).toBe(0);

    expect(
      await prisma.lodging.findFirst({ where: { userId, name: "Fully Reverted Hotel" } }),
    ).toBeNull();
  });

  it("refuses to revert another user's batch", async () => {
    const other = await prisma.user.create({
      data: { username: "lodging-import-batches-other", passwordHash: "x" },
    });
    const { batchId } = await commitLodgingImport(other.id, "csv", "theirs.csv", [
      { sourceRowIndex: 0, action: "create", lodging: { name: "Theirs" }, stay: null },
    ]);

    await expect(revertLodgingImportBatch(userId, batchId)).rejects.toThrow(
      "Import batch not found",
    );
    expect(await prisma.lodgingImportBatch.findUnique({ where: { id: batchId } })).not.toBeNull();

    await prisma.user.delete({ where: { id: other.id } });
  });

  it("does not list another user's batches", async () => {
    const other = await prisma.user.create({
      data: { username: "lodging-import-batches-list-other", passwordHash: "x" },
    });
    const { batchId } = await commitLodgingImport(other.id, "csv", "theirs-list.csv", [
      { sourceRowIndex: 0, action: "create", lodging: { name: "Their Hotel" }, stay: null },
    ]);

    const mine = await listLodgingImportBatches(userId);
    expect(mine.find((b) => b.id === batchId)).toBeUndefined();

    const theirs = await listLodgingImportBatches(other.id);
    expect(theirs.find((b) => b.id === batchId)).toBeDefined();

    await prisma.user.delete({ where: { id: other.id } });
  });
});
