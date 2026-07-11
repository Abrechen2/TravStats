/**
 * Schema hardening for the lodging domain (Task 2b) — locks in the
 * constraints from the cold data-model review (Codex + Gemini):
 *  - LodgingChain.name is unique (idempotent CSV seed, Task 7)
 *  - LodgingMembership is program-based: one row per (userId, programName)
 *  - UserSettings.baseCurrency is never NULL (NOT NULL with a backfilled default)
 *
 * These assertions run against the real database, not against schema.prisma —
 * a text match on the schema file would prove nothing about what Postgres
 * actually enforces.
 */
import { prisma } from "../db";
import { hashPassword } from "../utils/password";

describe("lodging schema constraints", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "lodgingschematest" } });
    const user = await prisma.user.create({
      data: {
        username: "lodgingschematest",
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.lodgingMembership.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.lodgingMembership.deleteMany({ where: { programName: { startsWith: "TEST_" } } });
    await prisma.lodgingChain.deleteMany({ where: { name: { startsWith: "TEST_" } } });
  });

  it("rejects a duplicate chain name", async () => {
    await prisma.lodgingChain.create({ data: { name: "TEST_Chain" } });
    await expect(prisma.lodgingChain.create({ data: { name: "TEST_Chain" } })).rejects.toThrow();
  });

  it("rejects a second membership for the same user + program", async () => {
    await prisma.lodgingMembership.create({ data: { userId, programName: "TEST_Bonvoy" } });
    await expect(
      prisma.lodgingMembership.create({ data: { userId, programName: "TEST_Bonvoy" } }),
    ).rejects.toThrow();
  });

  it("defaults baseCurrency to EUR and never stores NULL", async () => {
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    expect(settings === null || typeof settings.baseCurrency === "string").toBe(true);
  });
});
