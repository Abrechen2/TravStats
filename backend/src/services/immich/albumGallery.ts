/**
 * A linked album as the gallery reads it: one chronological list of photos,
 * and the same list cut into local days.
 *
 * The expensive part of an album view is never this list (the source answers
 * it with metadata only, and `immichAssetCache` keeps it) — it is the images.
 * So the gallery asks for COUNTS per day first and then for one day's photos
 * at a time, which keeps the browser from requesting the whole trip at once.
 */
import { prisma } from "../../db";
import { localDay } from "../../shared/time/instant";
import { createPhotoSource, listAllAlbumAssets, type AlbumAssetList } from "../photoSource";
import type { PhotoSourceKind } from "../photoSource/types";
import { getCachedAlbumAssets } from "./immichAssetCache";
import type { ImmichAsset, ImmichConnection } from "./types";

export interface GalleryAsset {
  id: string;
  url: string;
  previewUrl: string;
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
}

export interface AlbumLink {
  id: string;
  immichAlbumId: string;
  mode: string;
  provider: PhotoSourceKind;
}

/** Key of the bucket that holds photos without a usable capture time. */
export const UNDATED = "undated";

export interface DayCount {
  /** `YYYY-MM-DD` in the zone, or null for the undated bucket. */
  day: string | null;
  count: number;
}

const proxyUrl = (tripId: string, linkId: string, assetId: string, size: string): string =>
  `/api/v1/trips/${tripId}/immich/albums/${linkId}/assets/${assetId}/file?size=${size}`;

/** Oldest first; a photo without a capture time has nothing to sort by and goes last. */
function byCaptureTime(a: ImmichAsset, b: ImmichAsset): number {
  return a.fileCreatedAt === null || b.fileCreatedAt === null
    ? Number(a.fileCreatedAt === null) - Number(b.fileCreatedAt === null)
    : a.fileCreatedAt.localeCompare(b.fileCreatedAt);
}

/**
 * Every photo of the link in gallery order. `conn` is only read for a
 * link-mode album (an import-mode one is served from the stored `TripPhoto`
 * rows), so it may be null there.
 */
export async function listGalleryAssets(
  userId: string,
  tripId: string,
  link: AlbumLink,
  conn: ImmichConnection | null
): Promise<{ assets: GalleryAsset[]; truncated: boolean }> {
  if (link.mode === "import") {
    const photos = await prisma.tripPhoto.findMany({
      where: { immichAlbumLinkId: link.id },
      // Chronological, because an album of a trip is read as a diary. A photo
      // without an EXIF date keeps its link position at the end.
      orderBy: [{ takenAt: { sort: "asc", nulls: "last" } }, { sortIdx: "asc" }],
      select: { id: true, takenAt: true, lat: true, lon: true },
    });
    const fileUrl = (photoId: string): string => `/api/v1/trips/${tripId}/photos/${photoId}/file`;
    return {
      truncated: false,
      assets: photos.map((p) => ({
        id: p.id,
        url: fileUrl(p.id),
        previewUrl: fileUrl(p.id),
        takenAt: p.takenAt?.toISOString() ?? null,
        lat: p.lat,
        lon: p.lon,
      })),
    };
  }

  if (!conn) throw new Error("A link-mode album needs a connection");
  const listed = await getCachedAlbumAssets(
    userId,
    link.immichAlbumId,
    () => listAllAlbumAssets(createPhotoSource(link.provider, conn), link.immichAlbumId),
    link.provider
  );
  return {
    truncated: (listed as AlbumAssetList).truncated === true,
    assets: listed
      .filter((a: ImmichAsset) => a.type === "IMAGE")
      .slice()
      .sort(byCaptureTime)
      .map((a: ImmichAsset) => ({
        id: a.id,
        url: proxyUrl(tripId, link.id, a.id, "thumbnail"),
        previewUrl: proxyUrl(tripId, link.id, a.id, "preview"),
        takenAt: a.fileCreatedAt,
        lat: a.lat,
        lon: a.lon,
      })),
  };
}

/** Local day of a photo in `zone`, or null when it has no usable capture time. */
export function dayOfAsset(asset: Pick<GalleryAsset, "takenAt">, zone: string): string | null {
  if (!asset.takenAt || Number.isNaN(Date.parse(asset.takenAt))) return null;
  return localDay(asset.takenAt, zone);
}

/** Photos per local day, in order, undated last. Names no asset — this is what the day strip needs. */
export function countByDay(assets: readonly GalleryAsset[], zone: string): DayCount[] {
  const counts = new Map<string, number>();
  let undated = 0;
  for (const asset of assets) {
    const day = dayOfAsset(asset, zone);
    if (day === null) undated += 1;
    else counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days: DayCount[] = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }));
  if (undated > 0) days.push({ day: null, count: undated });
  return days;
}

/** The photos of one bucket (`YYYY-MM-DD`, `undated`, or `all`), gallery order. */
export function assetsOfDay(
  assets: readonly GalleryAsset[],
  day: string,
  zone: string
): GalleryAsset[] {
  if (day === "all") return assets.slice();
  return assets.filter((a) => (dayOfAsset(a, zone) ?? UNDATED) === day);
}
