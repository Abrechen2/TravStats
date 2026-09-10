import type { Prisma } from "@prisma/client";

/**
 * Everything hanging off a trip has to survive that trip being merged away.
 *
 * The merge moved flights, cruises, bookings, stops, routes, journal entries
 * and photos, and then deleted the source trips. Three relations were never on
 * that list — hotel stays, place visits and linked Immich albums — so the
 * delete reached them instead: the first two are `SetNull`, so a stay and a
 * visit simply lost the trip they belonged to, and the album is `Cascade`, so
 * it vanished. Worse, `TripPhoto.immichAlbumLinkId` cascades from that album
 * too, which means photos the merge had just moved ONTO the target were
 * deleted along with the source's album row (audit finding AUD-029).
 *
 * The rule this module encodes: the trip model's relation list is the merge
 * contract. A relation that exists and is not moved here is data the merge
 * loses.
 *
 * Two of those relations can collide, because both are unique per trip:
 *
 *  - `TripImmichAlbum` is unique on `(tripId, immichAlbumId)`. When both sides
 *    link the SAME Immich album, the target's row wins — it already carries the
 *    same album name, mode and sync state — and the source row's photos are
 *    re-pointed at it before it is dropped, so nothing hangs off a row that is
 *    about to go.
 *  - `TripPhoto` is unique on `(tripId, immichAssetId)`. The same asset
 *    imported into both trips is one photograph, not two: the target's copy
 *    stays and the source's duplicate row is dropped. Only the row goes — the
 *    file on disk is shared by filename and belongs to the surviving row.
 *
 * Manual photos (`immichAssetId = null`) never collide and always move.
 */
export type TripTx = Prisma.TransactionClient;

/**
 * Move linked Immich albums onto the target, folding duplicates into the
 * target's own link. Returns the number of source link rows dropped as
 * duplicates — a caller that logs the merge can say so.
 */
export async function mergeImmichAlbums(
  tx: TripTx,
  sourceIds: string[],
  targetId: string,
): Promise<number> {
  const [sourceAlbums, targetAlbums] = await Promise.all([
    tx.tripImmichAlbum.findMany({
      where: { tripId: { in: sourceIds } },
      select: { id: true, immichAlbumId: true },
    }),
    tx.tripImmichAlbum.findMany({
      where: { tripId: targetId },
      select: { id: true, immichAlbumId: true },
    }),
  ]);

  const targetByAlbum = new Map(targetAlbums.map((a) => [a.immichAlbumId, a.id]));
  const duplicates: string[] = [];

  for (const source of sourceAlbums) {
    const existing = targetByAlbum.get(source.immichAlbumId);
    if (!existing) {
      await tx.tripImmichAlbum.update({
        where: { id: source.id },
        data: { tripId: targetId },
      });
      // A second source trip linking the same album must now fold into the
      // row we just moved, not create a second one.
      targetByAlbum.set(source.immichAlbumId, source.id);
      continue;
    }
    // Re-point first, delete second. The other order would take the photos
    // with it through the cascade — which is the bug this module exists for.
    await tx.tripPhoto.updateMany({
      where: { immichAlbumLinkId: source.id },
      data: { immichAlbumLinkId: existing },
    });
    await tx.tripImmichAlbum.delete({ where: { id: source.id } });
    duplicates.push(source.id);
  }

  return duplicates.length;
}

/**
 * Move photos onto the target, dropping a source row that would duplicate an
 * Immich asset the target already holds. Returns the number dropped.
 */
export async function mergeTripPhotos(
  tx: TripTx,
  sourceIds: string[],
  targetId: string,
): Promise<number> {
  const targetAssets = await tx.tripPhoto.findMany({
    where: { tripId: targetId, immichAssetId: { not: null } },
    select: { immichAssetId: true },
  });
  const held = new Set(targetAssets.map((p) => p.immichAssetId as string));

  let dropped = 0;
  if (held.size > 0) {
    const collisions = await tx.tripPhoto.findMany({
      where: { tripId: { in: sourceIds }, immichAssetId: { in: [...held] } },
      select: { id: true },
    });
    if (collisions.length > 0) {
      await tx.tripPhoto.deleteMany({ where: { id: { in: collisions.map((c) => c.id) } } });
      dropped = collisions.length;
    }
  }

  await tx.tripPhoto.updateMany({
    where: { tripId: { in: sourceIds } },
    data: { tripId: targetId },
  });
  return dropped;
}
