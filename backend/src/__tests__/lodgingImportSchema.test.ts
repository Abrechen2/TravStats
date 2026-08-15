/**
 * Data model foundation for the lodging import (Task 1).
 *
 * `externalRef` gives an imported row a provable identity — a Google place
 * id or a Booking.com confirmation number — so re-importing the same file
 * or e-mail is a no-op instead of creating duplicates. Fuzzy name matching
 * was explicitly rejected: it already misfired once for a real user (a
 * "Hotel Belair" matched with high confidence to the wrong country).
 *
 * `batchId` + `LodgingImportBatch` make a bulk import revertible as a unit:
 * every row an import created carries the batch id, so undoing a bad
 * 232-row import doesn't mean deleting hotels by hand.
 */
import { prisma } from "../db";
import { Prisma } from "@prisma/client";

const USERNAME = "lodging-import-schema-test";

describe("lodging import schema", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("creates an import batch and stamps its id on the rows it created", async () => {
    const batch = await prisma.importBatch.create({
      data: { domain: "lodging", userId, source: "csv", fileName: "places.csv" },
    });
    expect(batch.source).toBe("csv");

    const lodging = await prisma.lodging.create({
      data: {
        userId,
        name: "Hotel Batch",
        externalRef: "google:ChIJtest1",
        batchId: batch.id,
      },
    });
    expect(lodging.batchId).toBe(batch.id);
    expect(lodging.externalRef).toBe("google:ChIJtest1");

    const stay = await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2026-01-01T00:00:00.000Z"),
        checkOut: new Date("2026-01-03T00:00:00.000Z"),
        externalRef: "booking:1111111111",
        batchId: batch.id,
      },
    });
    expect(stay.batchId).toBe(batch.id);

    await prisma.lodgingStay.deleteMany({ where: { batchId: batch.id } });
    await prisma.lodging.deleteMany({ where: { batchId: batch.id } });
    await prisma.importBatch.delete({ where: { id: batch.id } });
  });

  it("rejects a duplicate externalRef for the same user on lodgings", async () => {
    const first = await prisma.lodging.create({
      data: { userId, name: "Dup A", externalRef: "google:ChIJdup" },
    });
    await expect(
      prisma.lodging.create({ data: { userId, name: "Dup B", externalRef: "google:ChIJdup" } }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await prisma.lodging.delete({ where: { id: first.id } });
  });

  it("rejects a duplicate externalRef for the same user on stays", async () => {
    const lodging = await prisma.lodging.create({ data: { userId, name: "Stay Host" } });
    const first = await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2026-02-01T00:00:00.000Z"),
        checkOut: new Date("2026-02-02T00:00:00.000Z"),
        externalRef: "booking:2222222222",
      },
    });
    await expect(
      prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          checkIn: new Date("2026-03-01T00:00:00.000Z"),
          checkOut: new Date("2026-03-02T00:00:00.000Z"),
          externalRef: "booking:2222222222",
        },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await prisma.lodgingStay.delete({ where: { id: first.id } });
    await prisma.lodging.delete({ where: { id: lodging.id } });
  });

  it("allows many rows with a NULL externalRef", async () => {
    const a = await prisma.lodging.create({ data: { userId, name: "Null Ref A" } });
    const b = await prisma.lodging.create({ data: { userId, name: "Null Ref B" } });
    expect(a.externalRef).toBeNull();
    expect(b.externalRef).toBeNull();
    await prisma.lodging.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });

  it("allows the same externalRef for two different users", async () => {
    const otherUsername = `${USERNAME}-other`;
    await prisma.user.deleteMany({ where: { username: otherUsername } });
    const otherUser = await prisma.user.create({
      data: { username: otherUsername, passwordHash: "x" },
    });

    const mine = await prisma.lodging.create({
      data: { userId, name: "Shared Ref Mine", externalRef: "google:ChIJshared" },
    });
    const theirs = await prisma.lodging.create({
      data: { userId: otherUser.id, name: "Shared Ref Theirs", externalRef: "google:ChIJshared" },
    });
    expect(theirs.externalRef).toBe(mine.externalRef);

    await prisma.lodging.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });
});
