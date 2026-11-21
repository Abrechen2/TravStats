import { prisma } from "../../db";
import type { PhotoSourceKind } from "../photoSource";
import { toPhotoSourceKind } from "../photoSource/connection";
import type { Span } from "./readSafe";

/** Linked albums read per window; a trip rarely links more than a handful. */
const MAX_ALBUMS = 20;
const DAY_MS = 86_400_000;

export type LinkedAlbum = { provider: PhotoSourceKind; albumId: string };

export type LinkedAlbums = {
  albums: LinkedAlbum[];
  /** More albums were linked than are read: the list is a prefix. */
  truncated: boolean;
};

/**
 * The albums linked to the account's trips that run during `window` (a trip
 * with no end date counts as its start day). Generous by a day at the front:
 * the caller re-checks every photo's time against the window, so a trip that
 * only touches the window costs a read, never a wrong photo. Sorted so the
 * cache key and the read order are stable.
 */
export async function linkedAlbumsOf(userId: string, window: Span): Promise<LinkedAlbums> {
  const rows = await prisma.tripImmichAlbum.findMany({
    where: {
      trip: {
        userId,
        startDate: { lte: new Date(window.untilMs) },
        OR: [
          { endDate: { gte: new Date(window.fromMs - DAY_MS) } },
          { endDate: null, startDate: { gte: new Date(window.fromMs - DAY_MS) } },
        ],
      },
    },
    select: { provider: true, immichAlbumId: true },
    orderBy: [{ provider: "asc" }, { immichAlbumId: "asc" }],
  });
  const seen = new Set<string>();
  const albums: LinkedAlbum[] = [];
  for (const row of rows) {
    const provider = toPhotoSourceKind(row.provider);
    const key = `${provider}:${row.immichAlbumId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    albums.push({ provider, albumId: row.immichAlbumId });
  }
  // Bound after the dedupe: repeated links must not use up the distinct ones.
  return { albums: albums.slice(0, MAX_ALBUMS), truncated: albums.length > MAX_ALBUMS };
}
