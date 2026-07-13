/**
 * Schema-level guarantees for the Immich data model:
 *  - a linked album cascades from its trip
 *  - imported photos cascade from their album link
 *  - (tripId, immichAssetId) is unique, but many NULLs coexist (manual uploads)
 */
import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";
import { prisma } from "../db";

const USER = "immich-schema-test-user";

// `User` requires `passwordHash` (not `password`) and has no `email` column.
async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { username: `${USER}-${Date.now()}-${Math.random()}`, passwordHash: "x" },
  });
  return user.id;
}

describe("Immich schema", () => {
  let userId: string;

  beforeEach(async () => {
    userId = await makeUser();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: USER } } });
    await prisma.$disconnect();
  });

  it("cascades linked albums and imported photos when the trip is deleted", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Trip" } });
    const link = await prisma.tripImmichAlbum.create({
      data: { tripId: trip.id, immichAlbumId: "album-1", albumName: "Album 1", mode: "import" },
    });
    await prisma.tripPhoto.create({
      data: {
        tripId: trip.id,
        filename: "a.jpg",
        mimetype: "image/jpeg",
        sizeBytes: 1,
        immichAssetId: "asset-1",
        immichAlbumLinkId: link.id,
        lat: 52.5,
        lon: 13.4,
      },
    });

    await prisma.trip.delete({ where: { id: trip.id } });

    expect(await prisma.tripImmichAlbum.count({ where: { id: link.id } })).toBe(0);
    expect(await prisma.tripPhoto.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it("rejects a duplicate immichAssetId within one trip but allows many manual uploads", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Trip" } });
    const base = { tripId: trip.id, filename: "a.jpg", mimetype: "image/jpeg", sizeBytes: 1 };

    await prisma.tripPhoto.create({ data: { ...base, immichAssetId: "dupe" } });
    await expect(
      prisma.tripPhoto.create({ data: { ...base, immichAssetId: "dupe" } }),
    ).rejects.toThrow();

    // NULL immichAssetId is not constrained — manual uploads stay unlimited.
    await prisma.tripPhoto.create({ data: base });
    await prisma.tripPhoto.create({ data: base });
    expect(await prisma.tripPhoto.count({ where: { tripId: trip.id, immichAssetId: null } })).toBe(
      2,
    );
  });

  it("stores an import job keyed one-to-one to its album link", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Trip" } });
    const link = await prisma.tripImmichAlbum.create({
      data: { tripId: trip.id, immichAlbumId: "album-2", albumName: "Album 2", mode: "import" },
    });
    const job = await prisma.immichImportJob.create({
      data: { albumLinkId: link.id, status: "running", totalAssets: 10 },
    });
    expect(job.processedAssets).toBe(0);

    await prisma.tripImmichAlbum.delete({ where: { id: link.id } });
    expect(await prisma.immichImportJob.count({ where: { id: job.id } })).toBe(0);
  });
});
