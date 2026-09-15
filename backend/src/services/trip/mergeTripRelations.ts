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

export interface MergedPhotos {
  /** Source rows dropped as duplicates of an asset another row already holds. */
  dropped: number;
  /** Dropped row id → the row that survives for the same asset. */
  survivorFor: ReadonlyMap<string, string>;
}

/**
 * Move photos onto the target, keeping ONE row per Immich asset across the
 * target and every source.
 *
 * The first version dropped only source rows colliding with the TARGET's
 * assets. Two sources holding the same asset — an album linked from both
 * trips — then both moved onto an empty target and hit the unique
 * `(tripId, immichAssetId)` index, and the whole merge rolled back
 * (AUD-029). The target's own row wins where it has one; otherwise the
 * first source row in sort order does. Which row survived is reported, so
 * a cover URL naming a dropped row can follow its photo (AUD-030).
 */
export async function mergeTripPhotos(
  tx: TripTx,
  sourceIds: string[],
  targetId: string,
): Promise<MergedPhotos> {
  const imported = await tx.tripPhoto.findMany({
    where: { tripId: { in: [targetId, ...sourceIds] }, immichAssetId: { not: null } },
    select: { id: true, tripId: true, immichAssetId: true },
    orderBy: [{ sortIdx: "asc" }, { id: "asc" }],
  });

  const survivorByAsset = new Map<string, string>();
  for (const row of imported) {
    if (row.tripId === targetId && row.immichAssetId) survivorByAsset.set(row.immichAssetId, row.id);
  }
  const survivorFor = new Map<string, string>();
  for (const row of imported) {
    if (row.tripId === targetId || !row.immichAssetId) continue;
    const survivor = survivorByAsset.get(row.immichAssetId);
    if (survivor === undefined) {
      survivorByAsset.set(row.immichAssetId, row.id);
      continue;
    }
    survivorFor.set(row.id, survivor);
  }

  const dropIds = [...survivorFor.keys()];
  if (dropIds.length > 0) {
    await tx.tripPhoto.deleteMany({ where: { id: { in: dropIds } } });
  }

  await tx.tripPhoto.updateMany({
    where: { tripId: { in: sourceIds } },
    data: { tripId: targetId },
  });
  return { dropped: dropIds.length, survivorFor };
}

/**
 * Point an inherited cover image at the trip that now holds it.
 *
 * A cover is stored as a URL, and that URL names the trip:
 * `/api/v1/trips/<tripId>/photos/<photoId>/file`. When the target inherited a
 * source's cover, the id in the string stayed the source's — a trip that the
 * same transaction was about to delete — so the merged trip's cover answered
 * 404 while its photo sat happily under the new id (audit finding AUD-030).
 *
 * Only our own internal shape is rewritten. A cover somebody pasted from
 * elsewhere is their URL, not ours, and is returned untouched.
 *
 * `survivorFor` is what `mergeTripPhotos` reports: a source photo dropped as
 * a duplicate of the target's copy of the same asset. A cover naming that
 * dropped row kept its id and answered 404 against the merged trip
 * (AUD-030) — it now names the surviving row instead.
 */
const INTERNAL_COVER = /^\/api\/v1\/trips\/([^/]+)\/photos\/([^/]+)\/file$/;

export function retargetCoverUrl(
  url: string | null | undefined,
  sourceIds: string[],
  targetId: string,
  survivorFor: ReadonlyMap<string, string> = new Map(),
): string | null {
  if (!url) return null;
  const match = INTERNAL_COVER.exec(url);
  if (!match) return url;
  const [, tripId, photoId] = match;
  if (!sourceIds.includes(tripId)) return url;
  return `/api/v1/trips/${targetId}/photos/${survivorFor.get(photoId) ?? photoId}/file`;
}
