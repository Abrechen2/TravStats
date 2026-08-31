import { prisma } from "../../db";
import { listImportBatches, listImportBatchItems, revertImportBatch } from "../importBatchService";

/**
 * POI Phase D. `ImportBatch.places` was wired in the schema and nowhere else:
 * `IMPORT_DOMAINS` had no `"poi"`, the log's filter did not look at `places`,
 * and `revertImportBatch` had no POI branch while `asDomain` fell back to
 * `"lodging"`.
 *
 * The last one was not merely a gap. A POI batch fell through to the cruise arm
 * and deleted zero places, deleted the batch, and — `Place.batch` being
 * `onDelete: SetNull` — cleared every `batchId` on the way out. The undo
 * appeared to work, changed nothing the user could see, and destroyed the only
 * link that would have let them try again. Unreachable while nothing created a
 * POI batch, which is exactly what made it worth pinning before something did.
 */
describe("a POI import batch is visible and revertible", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { username: `poi-batch-${Date.now()}-${Math.random()}`, passwordHash: "x" },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.importBatch.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function seedBatch(): Promise<string> {
    const batch = await prisma.importBatch.create({
      data: { userId, domain: "poi", source: "csv", fileName: "saved.csv" },
    });
    await prisma.place.createMany({
      data: [
        { userId, name: "Colosseo", lat: 41.8902, lon: 12.4922, city: "Rom", batchId: batch.id },
        { userId, name: "Pantheon", lat: 41.8986, lon: 12.4769, city: "Rom", batchId: batch.id },
      ],
    });
    return batch.id;
  }

  it("shows up in the import log", async () => {
    const batchId = await seedBatch();
    const batches = await listImportBatches(userId);

    const mine = batches.find((b) => b.id === batchId);
    expect(mine).toBeDefined();
    expect(mine?.domain).toBe("poi");
    expect(mine?.counts.places).toBe(2);
  });

  it("lists its rows", async () => {
    const batchId = await seedBatch();
    const { items, total } = await listImportBatchItems(userId, batchId);

    expect(total).toBe(2);
    expect(items.map((i) => i.kind)).toEqual(["place", "place"]);
    expect(items.map((i) => i.label).sort()).toEqual(["Colosseo", "Pantheon"]);
    // A place has no date of its own — a visit does. Showing the row's creation
    // date would read as "when I was there", which is a different fact.
    expect(items.every((i) => i.date === null)).toBe(true);
  });

  it("actually deletes the places when reverted", async () => {
    const batchId = await seedBatch();
    const result = await revertImportBatch(userId, batchId);

    expect(result.domain).toBe("poi");
    expect(result.deleted).toBe(2);
    expect(await prisma.place.count({ where: { userId } })).toBe(0);
    expect(await prisma.importBatch.count({ where: { id: batchId } })).toBe(0);
  });

  it("refuses to revert a batch whose kind it does not recognise", async () => {
    // Undo is the one operation that must not guess: a batch written by a newer
    // build would otherwise be reverted down whichever path the fallback names.
    const batch = await prisma.importBatch.create({
      data: { userId, domain: "something-newer", source: "csv" },
    });

    await expect(revertImportBatch(userId, batch.id)).rejects.toThrow(/unknown kind/);
    expect(await prisma.importBatch.count({ where: { id: batch.id } })).toBe(1);
  });

  it("does not let one user revert another's import", async () => {
    const batchId = await seedBatch();
    const other = await prisma.user.create({
      data: { username: `poi-other-${Date.now()}-${Math.random()}`, passwordHash: "x" },
    });

    await expect(revertImportBatch(other.id, batchId)).rejects.toThrow(/not found/);
    expect(await prisma.place.count({ where: { userId } })).toBe(2);

    await prisma.user.deleteMany({ where: { id: other.id } });
  });
});
