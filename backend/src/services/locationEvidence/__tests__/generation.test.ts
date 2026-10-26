import { prisma } from "../../../db";
import { makeUser } from "../../travtrack/__tests__/fixtures";
import { bumpHistoryGeneration, historyGeneration } from "../generation";

describe("history generation", () => {
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    userId = await makeUser("evidence-generation-a");
    otherId = await makeUser("evidence-generation-b");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  it("starts at zero for an account that never removed anything", async () => {
    expect(await prisma.$transaction((tx) => historyGeneration(tx, userId))).toBe(0n);
  });

  it("a bump raises it by one, for this account only", async () => {
    const raised = await prisma.$transaction((tx) => bumpHistoryGeneration(tx, userId));
    expect(raised).toBe(1n);
    expect(await prisma.$transaction((tx) => bumpHistoryGeneration(tx, userId))).toBe(2n);
    expect(await prisma.$transaction((tx) => historyGeneration(tx, userId))).toBe(2n);
    expect(await prisma.$transaction((tx) => historyGeneration(tx, otherId))).toBe(0n);
  });

  it("a bump inside a rolled-back transaction leaves the generation unchanged", async () => {
    const before = await prisma.$transaction((tx) => historyGeneration(tx, userId));
    await expect(
      prisma.$transaction(async (tx) => {
        await bumpHistoryGeneration(tx, userId);
        throw new Error("removal failed");
      })
    ).rejects.toThrow("removal failed");
    expect(await prisma.$transaction((tx) => historyGeneration(tx, userId))).toBe(before);

    // The same holds for the very first bump, which creates the row.
    await expect(
      prisma.$transaction(async (tx) => {
        await bumpHistoryGeneration(tx, otherId);
        throw new Error("removal failed");
      })
    ).rejects.toThrow("removal failed");
    expect(await prisma.$transaction((tx) => historyGeneration(tx, otherId))).toBe(0n);
  });
});
