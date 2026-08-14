import { prisma } from "../db";
import { commitLodgingImport } from "../services/lodging/lodgingImportCommit";
import { hashPassword } from "../utils/password";

/**
 * A saved-places export mixes houses the user stayed at with houses they only
 * noted down. The file cannot tell them apart, so the importer asks — and the
 * answer has to survive all the way into the row, because everything
 * downstream (counts, achievements, "visited") reads it from there.
 */
describe("import: visited vs. noted down", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "visitedtest" } });
    const user = await prisma.user.create({
      data: { username: "visitedtest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.lodgingImportBatch.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const row = (name: string, visited?: boolean) => ({
    sourceRowIndex: 0,
    action: "create" as const,
    lodging: { name, type: "hotel" as const, visited },
    lodgingName: name,
    stay: null,
  });

  it("stores a noted-down house as not visited", async () => {
    await commitLodgingImport(userId, "csv", "merkliste.csv", [row("Hotel Vorgemerkt", false)]);
    const saved = await prisma.lodging.findFirstOrThrow({ where: { userId } });
    expect(saved.visited).toBe(false);
  });

  it("stores a visited house as visited", async () => {
    await commitLodgingImport(userId, "csv", "besucht.csv", [row("Hotel Besucht", true)]);
    const saved = await prisma.lodging.findFirstOrThrow({ where: { userId } });
    expect(saved.visited).toBe(true);
  });

  it("treats an absent answer as visited, never as a bookmark", async () => {
    // Every importer that existed before saved-places lists sends no such
    // field, and its rows are real stays. Defaulting the other way would
    // silently demote all of them.
    await commitLodgingImport(userId, "email", "buchung.msg", [row("Hotel Ohne Angabe")]);
    const saved = await prisma.lodging.findFirstOrThrow({ where: { userId } });
    expect(saved.visited).toBe(true);
  });

  it("creates the house without a stay when the file has no dates", async () => {
    const result = await commitLodgingImport(userId, "csv", "hotels.csv", [
      row("Engimatt City & Garden Hotel", true),
    ]);
    expect(result.createdLodgings).toBe(1);
    expect(result.createdStays).toBe(0);
    expect(await prisma.lodgingStay.count({ where: { userId } })).toBe(0);
  });
});
