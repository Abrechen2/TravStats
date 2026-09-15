import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { mergeTrips } from "../tripCleanupService";
import { detectTrips } from "../tripDetectionService";

/**
 * Two ways a trip's contents used to disappear, both from a button the user
 * pressed for something else entirely.
 *
 * **Merging** (AUD-029) moved flights, cruises, bookings, stops, routes,
 * journal entries and photos, then deleted the source trips. Hotel stays and
 * place visits were not on that list and are `SetNull`, so they quietly lost
 * their trip; linked Immich albums are `Cascade`, so they were deleted — and
 * `TripPhoto.immichAlbumLinkId` cascades from the album, which deleted photos
 * the merge had already moved onto the TARGET.
 *
 * **Flight detection** (AUD-028) finished by deleting every trip in the account
 * with no flight linked, calling them orphans. A rail trip, a cruise, a hotel
 * weekend — all flightless, all deleted, with their stops and journal entries
 * going by cascade. It ran even when the run created nothing at all, so
 * confirming the dialog with an empty selection was enough.
 */
const USERNAME = `trip-preserve-${Date.now()}`;

describe("a trip keeps its contents", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
  });

  describe("when another trip is merged into it", () => {
    it("carries the hotel stay, the place visit and the album across", async () => {
      const target = await prisma.trip.create({ data: { userId, name: "Target" } });
      const source = await prisma.trip.create({ data: { userId, name: "Source" } });

      const lodging = await prisma.lodging.create({
        data: { userId, name: "Merge Hotel", type: "hotel" },
      });
      const stay = await prisma.lodgingStay.create({
        data: { userId, lodgingId: lodging.id, tripId: source.id, status: "completed" },
      });
      const place = await prisma.place.create({
        data: { userId, name: "Merge Place", lat: 41.89, lon: 12.49 },
      });
      const visit = await prisma.placeVisit.create({
        data: { userId, placeId: place.id, tripId: source.id },
      });
      const album = await prisma.tripImmichAlbum.create({
        data: { tripId: source.id, immichAlbumId: "album-a", albumName: "Album A", mode: "import" },
      });
      const photo = await prisma.tripPhoto.create({
        data: {
          tripId: source.id,
          filename: "a.jpg",
          mimetype: "image/jpeg",
          sizeBytes: 10,
          immichAssetId: "asset-a",
          immichAlbumLinkId: album.id,
        },
      });

      await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

      expect((await prisma.lodgingStay.findUniqueOrThrow({ where: { id: stay.id } })).tripId).toBe(
        target.id,
      );
      expect((await prisma.placeVisit.findUniqueOrThrow({ where: { id: visit.id } })).tripId).toBe(
        target.id,
      );
      expect((await prisma.tripImmichAlbum.findUniqueOrThrow({ where: { id: album.id } })).tripId)
        .toBe(target.id);
      // The photo is the one that used to be deleted by the album's cascade
      // AFTER the merge had already moved it.
      const movedPhoto = await prisma.tripPhoto.findUnique({ where: { id: photo.id } });
      expect(movedPhoto).not.toBeNull();
      expect(movedPhoto?.tripId).toBe(target.id);
    });

    it("folds a duplicate album into the target's own and keeps both sides' photos", async () => {
      const target = await prisma.trip.create({ data: { userId, name: "Target" } });
      const source = await prisma.trip.create({ data: { userId, name: "Source" } });

      const targetAlbum = await prisma.tripImmichAlbum.create({
        data: { tripId: target.id, immichAlbumId: "shared", albumName: "Shared", mode: "import" },
      });
      const sourceAlbum = await prisma.tripImmichAlbum.create({
        data: { tripId: source.id, immichAlbumId: "shared", albumName: "Shared", mode: "import" },
      });
      const sourcePhoto = await prisma.tripPhoto.create({
        data: {
          tripId: source.id,
          filename: "s.jpg",
          mimetype: "image/jpeg",
          sizeBytes: 10,
          immichAssetId: "asset-source-only",
          immichAlbumLinkId: sourceAlbum.id,
        },
      });

      await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

      // One link row for the album, the target's own.
      const albums = await prisma.tripImmichAlbum.findMany({ where: { tripId: target.id } });
      expect(albums.map((a) => a.id)).toEqual([targetAlbum.id]);

      // The source's photo survived and now hangs off the surviving link.
      const kept = await prisma.tripPhoto.findUniqueOrThrow({ where: { id: sourcePhoto.id } });
      expect(kept.tripId).toBe(target.id);
      expect(kept.immichAlbumLinkId).toBe(targetAlbum.id);
    });

    it("keeps one row when both sides hold the same imported asset", async () => {
      const target = await prisma.trip.create({ data: { userId, name: "Target" } });
      const source = await prisma.trip.create({ data: { userId, name: "Source" } });

      const targetPhoto = await prisma.tripPhoto.create({
        data: {
          tripId: target.id,
          filename: "dup.jpg",
          mimetype: "image/jpeg",
          sizeBytes: 10,
          immichAssetId: "asset-dup",
        },
      });
      await prisma.tripPhoto.create({
        data: {
          tripId: source.id,
          filename: "dup.jpg",
          mimetype: "image/jpeg",
          sizeBytes: 10,
          immichAssetId: "asset-dup",
        },
      });

      // Without a conflict rule this throws on the unique (tripId, assetId).
      await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

      const photos = await prisma.tripPhoto.findMany({ where: { tripId: target.id } });
      expect(photos.map((p) => p.id)).toEqual([targetPhoto.id]);
    });

    // AUD-029, the residual case: the dedupe only looked at the TARGET's
    // assets, so two sources holding the same one both moved and the unique
    // index threw — the merge rolled back.
    it("keeps one row when two SOURCES hold the same asset and the target none", async () => {
      const target = await prisma.trip.create({ data: { userId, name: "Target" } });
      const sourceA = await prisma.trip.create({ data: { userId, name: "Source A" } });
      const sourceB = await prisma.trip.create({ data: { userId, name: "Source B" } });
      const shared = { filename: "shared.jpg", mimetype: "image/jpeg", sizeBytes: 10, immichAssetId: "asset-shared" };
      const first = await prisma.tripPhoto.create({ data: { tripId: sourceA.id, ...shared, sortIdx: 0 } });
      await prisma.tripPhoto.create({ data: { tripId: sourceB.id, ...shared, sortIdx: 1 } });

      await mergeTrips(userId, {
        tripIds: [target.id, sourceA.id, sourceB.id],
        targetId: target.id,
      });

      const photos = await prisma.tripPhoto.findMany({ where: { tripId: target.id } });
      expect(photos.map((p) => p.id)).toEqual([first.id]);
      expect(await prisma.trip.count({ where: { userId } })).toBe(1);
    });

    // AUD-030, the residual case: the cover named the SOURCE's copy of an
    // asset the target already held. The copy was dropped as a duplicate and
    // the rewritten URL kept its id — a 404 on the merged trip.
    it("points a cover at the surviving copy of a deduplicated photo", async () => {
      const target = await prisma.trip.create({ data: { userId, name: "Target" } });
      const source = await prisma.trip.create({ data: { userId, name: "Source" } });
      const dup = { filename: "dup.jpg", mimetype: "image/jpeg", sizeBytes: 10, immichAssetId: "asset-cover" };
      const kept = await prisma.tripPhoto.create({ data: { tripId: target.id, ...dup } });
      const dropped = await prisma.tripPhoto.create({ data: { tripId: source.id, ...dup } });
      await prisma.trip.update({
        where: { id: source.id },
        data: { coverImageUrl: `/api/v1/trips/${source.id}/photos/${dropped.id}/file` },
      });

      await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

      const merged = await prisma.trip.findUniqueOrThrow({ where: { id: target.id } });
      expect(merged.coverImageUrl).toBe(`/api/v1/trips/${target.id}/photos/${kept.id}/file`);
      expect(await prisma.tripPhoto.findUnique({ where: { id: dropped.id } })).toBeNull();
    });

    it("points an inherited cover image at the trip that now holds it", async () => {
      const target = await prisma.trip.create({ data: { userId, name: "Target" } });
      const source = await prisma.trip.create({ data: { userId, name: "Source" } });

      const cover = await prisma.tripPhoto.create({
        data: {
          tripId: source.id,
          filename: "cover.jpg",
          mimetype: "image/jpeg",
          sizeBytes: 10,
          caption: "__cover__",
          sortIdx: -1,
        },
      });
      await prisma.trip.update({
        where: { id: source.id },
        data: { coverImageUrl: `/api/v1/trips/${source.id}/photos/${cover.id}/file` },
      });

      await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

      const merged = await prisma.trip.findUniqueOrThrow({ where: { id: target.id } });
      // The photo moved; the URL used to keep naming the deleted trip and 404.
      expect(merged.coverImageUrl).toBe(`/api/v1/trips/${target.id}/photos/${cover.id}/file`);
      expect((await prisma.tripPhoto.findUniqueOrThrow({ where: { id: cover.id } })).tripId).toBe(
        target.id,
      );
    });

    it("leaves a cover somebody pasted from elsewhere alone", async () => {
      const target = await prisma.trip.create({ data: { userId, name: "Target" } });
      const source = await prisma.trip.create({
        data: { userId, name: "Source", coverImageUrl: "https://example.com/photo.jpg" },
      });

      await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

      const merged = await prisma.trip.findUniqueOrThrow({ where: { id: target.id } });
      expect(merged.coverImageUrl).toBe("https://example.com/photo.jpg");
    });
  });

  describe("when flight detection is confirmed", () => {
    it("leaves a curated trip that simply has no flight alone", async () => {
      const rail = await prisma.trip.create({
        data: { userId, name: "Rail to Vienna", notes: "Hand-written" },
      });
      const stop = await prisma.tripStop.create({
        data: { tripId: rail.id, title: "Vienna" },
      });
      const entry = await prisma.tripJournalEntry.create({
        data: { tripId: rail.id, date: new Date("2026-04-01"), body: "Arrived" },
      });

      const result = await detectTrips({ userId, dryRun: false, selectedProposals: [] });

      expect(result.orphansRemoved).toBe(0);
      expect(await prisma.trip.findUnique({ where: { id: rail.id } })).not.toBeNull();
      expect(await prisma.tripStop.findUnique({ where: { id: stop.id } })).not.toBeNull();
      expect(
        await prisma.tripJournalEntry.findUnique({ where: { id: entry.id } }),
      ).not.toBeNull();
    });
  });
});
