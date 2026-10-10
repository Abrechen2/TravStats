import fsp from "fs/promises";

import { prisma } from "../../db";
import { getTripPhotoDir } from "../../middleware/upload";
import { SHARE_LINK_MAX_PHOTOS } from "../../schemas/shareLinks";
import { photoFileToServe, isHeifMimetype } from "../photos/displayRendition";
import { NOT_A_COVER } from "../trips/photoStation";
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
 * removed (`stripImageMetadata`). A type the stripper cannot clean is not
 * offered at all, so the preview counts exactly what the public receives.
 */

const SERVABLE = new Set(["image/jpeg", "image/jpg", "image/png"]);
const servable = (mimetype: string) =>
  SERVABLE.has(mimetype.toLowerCase()) || isHeifMimetype(mimetype);

/** The first photos of a trip in gallery order that a link may carry. */
export async function photoSnapshot(tripId: string): Promise<string[]> {
  const rows = await prisma.tripPhoto.findMany({
    where: { tripId, ...NOT_A_COVER },
    orderBy: [{ sortIdx: "asc" }, { createdAt: "asc" }],
    select: { id: true, mimetype: true },
    take: 200,
  });
  return rows
    .filter((r) => servable(r.mimetype))
    .slice(0, SHARE_LINK_MAX_PHOTOS)
    .map((r) => r.id);
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
  const served = await photoFileToServe(
    getTripPhotoDir(),
    photo.filename,
    photo.mimetype,
    "display"
  );
  if (!served) return null;
  const clean = stripImageMetadata(await fsp.readFile(served.filePath), served.type);
  return clean
    ? { bytes: clean, type: served.type === "image/jpg" ? "image/jpeg" : served.type }
    : null;
}
