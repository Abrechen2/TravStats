import { prisma } from "../../db";
import { deletePlacePhotoFile } from "../../middleware/upload";
import logger from "../../utils/logger";
import { createImmichClient } from "../immich/immichClient";
import { getImmichConnection } from "../immich/immichResolver";

/**
 * Place-visit photos stop being copies and become links (forgejo#21).
 *
 * The Companion uploads a visit photo as a TEMPORARY copy and tells the user
 * it will become a library link later. This is the "later": every copy of the
 * caller's that carries a checksum is looked up in their Immich by that
 * checksum — SHA-1 of the bytes, the value Immich itself keeps — and a match
 * is exact, never a guess from a file name. A matched row keeps its id, its
 * caption and its order, gains `immichAssetId`, and loses the copy on disk.
 *
 * Owner decision 2026-09-17: the row is the grant. The file route streams the
 * asset id stored on a row the caller owns, and never an id a request names —
 * the same rule the photo-journey preview follows — so linking a photo cannot
 * be turned into reading the rest of the library.
 *
 * Rows without a checksum (uploaded before the column existed) are left as
 * copies. Matching them by name and size would be the guess this column was
 * added to avoid.
 */

export type LinkOutcome =
  { kind: "notConfigured" } | { kind: "linked"; checked: number; linked: number };

/** Only a few hundred at a time: each is one search against the user's Immich. */
const BATCH = 500;

export async function linkVisitPhotosToImmich(userId: string): Promise<LinkOutcome> {
  const connection = await getImmichConnection(userId);
  if (connection === null) return { kind: "notConfigured" };
  const client = createImmichClient(connection);

  const copies = await prisma.placeVisitPhoto.findMany({
    where: {
      visit: { userId },
      checksum: { not: null },
      immichAssetId: null,
      filename: { not: null },
    },
    select: { id: true, checksum: true, filename: true },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });

  let linked = 0;
  for (const copy of copies) {
    // An unreachable Immich throws here and ends the pass: better to stop than
    // to report "no match" for photos that were never asked about.
    const assetId = await client.findAssetIdByChecksum(copy.checksum!);
    if (assetId === null) continue;
    // Row first, bytes second — the order every photo delete here keeps.
    await prisma.placeVisitPhoto.update({
      where: { id: copy.id },
      data: { immichAssetId: assetId, filename: null },
    });
    deletePlacePhotoFile(copy.filename!);
    linked++;
  }

  if (linked > 0) {
    logger.info(
      { operation: "visit_photos_linked_to_immich", userId, checked: copies.length, linked },
      "Place-visit photo copies became Immich links"
    );
  }
  return { kind: "linked", checked: copies.length, linked };
}
