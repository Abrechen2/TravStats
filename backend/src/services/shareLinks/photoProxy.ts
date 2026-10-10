import fsp from "fs/promises";

import { prisma } from "../../db";
import { getTripPhotoDir } from "../../middleware/upload";
import { SHARE_LINK_MAX_PHOTOS } from "../../schemas/shareLinks";
import { photoFileToServe, isHeifMimetype } from "../photos/displayRendition";
import { NOT_A_COVER } from "../trips/photoStation";
import logger from "../../utils/logger";
import { stripImageMetadata } from "./stripImageMetadata";

/**
 * The photos of a public trip link (forgejo#281).
 *
 * Which photos: the ones the owner saw in the preview, snapshotted as ids on
 * the link when it was made — a photo added to the trip later is not shared
 * by a link made before it. The public side asks by INDEX into that list and
 * never names a photo; every id is re-checked against the link's trip on each
 * request, so a photo moved or deleted since is simply gone.
 *
 * Which bytes: the display rendition (a HEIC's JPEG copy) with its metadata
 * removed (`stripImageMetadata`). A photo the stripper cannot clean is not
 * offered at all (`photoSnapshot`), so the preview counts exactly what the
 * public receives.
 */

const SERVABLE = new Set(["image/jpeg", "image/jpg", "image/png"]);
const servable = (mimetype: string) =>
  SERVABLE.has(mimetype.toLowerCase()) || isHeifMimetype(mimetype);

/** Why photos of a trip are not in a link — told to the owner in the preview, never to the public. */
export interface PhotoOmissions {
  /** Not JPEG, PNG or HEIC (e.g. WebP, GIF): nothing that can be cleaned of metadata. */
  unsupportedType: number;
  /** The file is missing, cannot be converted, or does not parse as what it claims to be. */
  unreadable: number;
  /** Beyond the first SHARE_LINK_MAX_PHOTOS servable photos. */
  overLimit: number;
}

/**
 * The first photos of a trip in gallery order that the public page WILL
 * serve, checked the way it serves them: the display rendition is produced and
 * run through the stripper, whose magic-byte check refuses a file whose
 * stored type is wrong. So the preview's count and the link's snapshot are
 * the photos a viewer actually receives, and the owner learns why the others
 * are not in it.
 */
export async function photoSnapshot(
  tripId: string
): Promise<{ ids: string[]; omitted: PhotoOmissions }> {
  const rows = await prisma.tripPhoto.findMany({
    where: { tripId, ...NOT_A_COVER },
    orderBy: [{ sortIdx: "asc" }, { createdAt: "asc" }],
    select: { id: true, filename: true, mimetype: true },
    take: 200,
  });
  const ids: string[] = [];
  const omitted: PhotoOmissions = { unsupportedType: 0, unreadable: 0, overLimit: 0 };
  for (const row of rows) {
    if (!servable(row.mimetype)) omitted.unsupportedType += 1;
    else if (ids.length >= SHARE_LINK_MAX_PHOTOS) omitted.overLimit += 1;
    else if (await cleanPhotoBytes(row.filename, row.mimetype)) ids.push(row.id);
    else omitted.unreadable += 1;
  }
  return { ids, omitted };
}

/** A stored photo's display bytes without metadata, or null when they cannot be served cleanly. */
async function cleanPhotoBytes(
  filename: string,
  mimetype: string
): Promise<{ bytes: Buffer; type: string } | null> {
  try {
    const served = await photoFileToServe(getTripPhotoDir(), filename, mimetype, "display");
    if (!served) return null;
    const clean = stripImageMetadata(await fsp.readFile(served.filePath), served.type);
    if (!clean) return null;
    return { bytes: clean, type: served.type === "image/jpg" ? "image/jpeg" : served.type };
  } catch (error) {
    // A HEIC that cannot be converted, a file that vanished between the
    // existence check and the read: not servable, and logged as such.
    logger.warn({
      operation: "share_link_photo_unservable",
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

/** The snapshotted ids still on the trip and still servable, in the snapshot's order. */
export async function shareablePhotoIds(
  tripId: string,
  photoIds: readonly string[]
): Promise<string[]> {
  if (photoIds.length === 0) return [];
  const rows = await prisma.tripPhoto.findMany({
    where: { tripId, id: { in: [...photoIds] }, ...NOT_A_COVER },
    select: { id: true, mimetype: true },
  });
  const live = new Set(rows.filter((r) => servable(r.mimetype)).map((r) => r.id));
  return photoIds.filter((id) => live.has(id)).slice(0, SHARE_LINK_MAX_PHOTOS);
}

/** Cleaned bytes of the photo at `index`, or null — the caller's uniform 404. */
export async function sharedPhotoBytes(
  tripId: string,
  photoIds: readonly string[],
  index: number
): Promise<{ bytes: Buffer; type: string } | null> {
  const ids = await shareablePhotoIds(tripId, photoIds);
  const id = ids[index];
  if (!id) return null;
  const photo = await prisma.tripPhoto.findFirst({
    where: { id, tripId },
    select: { filename: true, mimetype: true },
  });
  if (!photo) return null;
  return cleanPhotoBytes(photo.filename, photo.mimetype);
}
