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

    expect(
      await prisma.lodging.findFirst({ where: { userId, name: "Revert Me Hotel" } }),
    ).toBeNull();
    expect(await prisma.lodging.findUnique({ where: { id: preExisting.id } })).not.toBeNull();
    expect(await prisma.lodgingStay.count({ where: { lodgingId: preExisting.id } })).toBe(0);
    expect(await prisma.lodgingImportBatch.findUnique({ where: { id: batchId } })).toBeNull();

    await prisma.lodging.delete({ where: { id: preExisting.id } });
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
});
