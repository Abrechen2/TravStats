import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";
import { prisma } from "../db";
import { seedLodgingChainsFromCSV } from "../seedLodgingChainsFromCSV";

describe("seedLodgingChainsFromCSV", () => {
  beforeEach(async () => {
    // Wipe ALL rows (incl. isUserAdded) so each test starts clean, matching
    // the project convention for the ship/port catalog seed tests. Safe
    // against cross-suite interference because jest.config.js pins
    // maxWorkers to 1 — no other test file's requests can interleave with
    // this wipe, and the lodging-chains route tests never assert on total
    // row counts (they track their own rows by id).
    await prisma.lodgingChain.deleteMany({});
  });

  afterAll(async () => {
    // Leave the dev DB populated with the real seed data.
    await prisma.lodgingChain.deleteMany({});
    await seedLodgingChainsFromCSV();
    await prisma.$disconnect();
  });

  it("inserts all rows from the CSV on a fresh DB", async () => {
    const count = await seedLodgingChainsFromCSV();
    expect(count).toBeGreaterThanOrEqual(10);
    const rows = await prisma.lodgingChain.count();
    expect(rows).toBe(count);
  });

  it("is idempotent — running twice does not duplicate rows", async () => {
    const first = await seedLodgingChainsFromCSV();
    const second = await seedLodgingChainsFromCSV();
    expect(second).toBe(0);
    const rows = await prisma.lodgingChain.count();
    expect(rows).toBe(first);
  });

  it("seeds chains idempotently and preserves user-added rows", async () => {
    await seedLodgingChainsFromCSV();
    const first = await prisma.lodgingChain.count();
    await prisma.lodgingChain.create({ data: { name: "User Group", isUserAdded: true } });
    await seedLodgingChainsFromCSV(); // second run
    expect(await prisma.lodgingChain.count()).toBe(first + 1);
    expect(await prisma.lodgingChain.findFirst({ where: { name: "User Group" } })).not.toBeNull();
  });

  it("does not overwrite a seeded row's fields on re-seed", async () => {
    await seedLodgingChainsFromCSV();
    const marriott = await prisma.lodgingChain.findFirst({ where: { name: "Marriott" } });
    expect(marriott).not.toBeNull();
    await prisma.lodgingChain.update({
      where: { id: marriott!.id },
      data: { brandColor: "#000000" },
    });
    await seedLodgingChainsFromCSV();
    const reloaded = await prisma.lodgingChain.findUnique({ where: { id: marriott!.id } });
    expect(reloaded?.brandColor).toBe("#000000");
  });

  it("does not create a case-variant duplicate of a user-added chain", async () => {
    await prisma.lodgingChain.create({ data: { name: "hilton", isUserAdded: true } });
    await seedLodgingChainsFromCSV();
    const matches = await prisma.lodgingChain.findMany({
      where: { name: { equals: "hilton", mode: "insensitive" } },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].isUserAdded).toBe(true);
  });

  it("skips malformed rows without throwing", async () => {
    await expect(seedLodgingChainsFromCSV()).resolves.not.toThrow();
  });
});
