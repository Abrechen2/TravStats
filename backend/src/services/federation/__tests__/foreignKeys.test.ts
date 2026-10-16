import { randomUUID } from "crypto";
import { prisma } from "../../../db";

afterAll(async () => {
  await prisma.$disconnect();
});

it("removes a deleted account's comparison audit trail with the account", async () => {
  // owner_id had no foreign key, so a deleted user's audit rows (channels, audiences, times)
  // outlived the account forever.
  const owner = await prisma.user.create({
    data: { username: `fk-audit-${randomUUID()}`, passwordHash: "test-only" },
  });
  await prisma.comparisonAudit.create({
    data: {
      ownerId: owner.id,
      channel: randomUUID(),
      audience: "",
      revision: 1,
      operation: "grant",
    },
  });
  await prisma.user.delete({ where: { id: owner.id } });
  expect(await prisma.comparisonAudit.count({ where: { ownerId: owner.id } })).toBe(0);
});

it("refuses ciphertext for a link that does not exist and drops it with its link", async () => {
  const owner = await prisma.user.create({
    data: { username: `fk-publication-${randomUUID()}`, passwordHash: "test-only" },
  });
  try {
    const publication = (linkId: string) =>
      prisma.comparisonPublication.create({
        data: {
          id: randomUUID(),
          userId: owner.id,
          linkId,
          audience: "",
          revision: 1,
          sender: "f".repeat(64),
          context: {},
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    await expect(publication(randomUUID())).rejects.toThrow();
    const link = await prisma.comparisonLink.create({
      data: { userId: owner.id, channel: randomUUID(), origin: "local", label: "friend" },
    });
    const stored = await publication(link.id);
    await prisma.comparisonLink.delete({ where: { id: link.id } });
    expect(await prisma.comparisonPublication.findUnique({ where: { id: stored.id } })).toBeNull();
  } finally {
    await prisma.user.delete({ where: { id: owner.id } });
  }
});
