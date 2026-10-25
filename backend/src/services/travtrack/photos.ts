import { prisma } from "../../db";
import { createImmichClient, type ImmichClient } from "../immich/immichClient";
import { getImmichConnection } from "../immich/immichResolver";
import type { ImmichConnection } from "../immich/types";
import { historyGeneration } from "../locationEvidence/generation";
import type { StoredPoint } from "../tripRecording/segments";
import { inPrivacyZone, type ZoneCircle } from "./classify";
import { readSafeTravTrack, type SafeCursor, type Span } from "./readSafe";

/**
 * Photos taken during a window, placed on the account's own track (TravTrack
 * plan T5.3, the flight panel and the map): the user's Immich connection
 * (`getImmichConnection`: user → admin-global → ENV) is asked for the assets
 * taken in the window, and each is placed by its capture TIME on the
 * privacy-safe track (`readSafe.ts`) — between the two consecutive vertices of
 * one stretch around it.
 *
 *   - A photo whose time falls in no stretch (a privacy zone, a deleted span,
 *     a pause, a flight-mode cut, or no recording) is NOT returned at all: a
 *     photo without a place could say where a zone hides.
 *   - The position is never the photo's EXIF GPS (`ImmichAsset.lat/lon` are
 *     not read) and never a point inside a privacy circle: an interpolated
 *     position is checked against the circles once more.
 *
 * The result is the grant of the thumbnail route: only an asset this list
 * holds is streamed (`photoInWindow`). Cached per account, window and history
 * generation for a minute, so a grid of thumbnails costs one Immich search;
 * a new zone or a deletion raises the generation and with it the key.
 */

/** The longest window one request asks Immich about. */
export const PHOTO_WINDOW_MAX_MS = 7 * 86_400_000;
const READ_PAGE = 50_000;
const MAX_READ_PAGES = 10;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

export type TravTrackPhoto = {
  assetId: string;
  type: "IMAGE" | "VIDEO";
  takenAt: string;
  /** On the privacy-safe track at `takenAt`; never the photo's own EXIF. */
  lat: number;
  lon: number;
};

export type TravTrackPhotos = {
  photos: TravTrackPhoto[];
  /** Immich held more photos in the window than one search returns. */
  truncated: boolean;
};

export type PhotoDeps = {
  connection?: (userId: string) => Promise<ImmichConnection | null>;
  client?: (conn: ImmichConnection) => Pick<ImmichClient, "searchAssetsByDate">;
};

/** No Immich connection resolves for the account. */
export class PhotosNotConfigured extends Error {}

/** Where `[a, b]` puts the instant `t` (a ≤ t ≤ b), on the shorter way round the globe. */
function between(a: StoredPoint, b: StoredPoint, t: number): { lat: number; lon: number } {
  const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
  let dLon = b[2] - a[2];
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  let lon = a[2] + f * dLon;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat: a[1] + f * (b[1] - a[1]), lon };
}

/**
 * The position of instant `t` on these stretches, or null when it lies in none
 * or the position would fall inside a circle. Stretches are never bridged: an
 * instant between two stretches has no position.
 */
export function positionAt(
  stretches: readonly StoredPoint[][],
  circles: readonly ZoneCircle[],
  t: number
): { lat: number; lon: number } | null {
  for (const s of stretches) {
    if (s.length === 0 || t < s[0][0] || t > s[s.length - 1][0]) continue;
    for (let i = 0; i < s.length; i++) {
      if (s[i][0] === t) {
        const p = { lat: s[i][1], lon: s[i][2] };
        return inPrivacyZone(p, circles) ? null : p;
      }
      if (i > 0 && s[i - 1][0] < t && t < s[i][0]) {
        const p = between(s[i - 1], s[i], t);
        return inPrivacyZone(p, circles) ? null : p;
      }
    }
  }
  return null;
}

/** The window's safe stretches, page by page (each page's stretches stand alone). */
async function safeStretches(userId: string, window: Span) {
  const stretches: StoredPoint[][] = [];
  const circles: ZoneCircle[] = [];
  let cursor: SafeCursor | null = null;
  for (let page = 0; page < MAX_READ_PAGES; page++) {
    const read = await readSafeTravTrack(userId, window, READ_PAGE, cursor);
    stretches.push(...read.segments);
    if (page === 0) circles.push(...read.circles);
    if (!read.next || !read.cursor) break;
    cursor = read.cursor;
  }
  return { stretches, circles };
}

const cache = new Map<string, { at: number; value: Promise<TravTrackPhotos> }>();

/** Test seam: forget every cached window. */
export function clearTravTrackPhotoCache(): void {
  cache.clear();
}

async function computePhotos(
  userId: string,
  window: Span,
  conn: ImmichConnection,
  deps: PhotoDeps
): Promise<TravTrackPhotos> {
  const client = (deps.client ?? createImmichClient)(conn);
  const [{ stretches, circles }, page] = await Promise.all([
    safeStretches(userId, window),
    // Immich's range is inclusive on both ends; the window's end is not.
    client.searchAssetsByDate({
      takenAfter: new Date(window.fromMs),
      takenBefore: new Date(window.untilMs - 1),
    }),
  ]);
  const photos: TravTrackPhoto[] = [];
  for (const asset of page.assets) {
    const t = Date.parse(asset.fileCreatedAt);
    if (!Number.isFinite(t) || t < window.fromMs || t >= window.untilMs) continue;
    const at = positionAt(stretches, circles, t);
    if (!at) continue;
    photos.push({ assetId: asset.id, type: asset.type, takenAt: new Date(t).toISOString(), ...at });
  }
  photos.sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.assetId.localeCompare(b.assetId));
  return { photos, truncated: page.truncated };
}

/**
 * The window's photos with a safe position. Throws `PhotosNotConfigured`
 * without a connection and lets an `ImmichError` through (its `kind` is the
 * vocabulary the route answers with).
 */
export async function travTrackPhotos(
  userId: string,
  window: Span,
  deps: PhotoDeps = {}
): Promise<TravTrackPhotos> {
  const conn = await (deps.connection ?? getImmichConnection)(userId);
  if (!conn) throw new PhotosNotConfigured();
  const generation = await historyGeneration(prisma, userId);
  const key = `${userId}|${window.fromMs}|${window.untilMs}|${generation}|${conn.source}|${conn.baseUrl}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  const value = computePhotos(userId, window, conn, deps);
  cache.set(key, { at: now, value });
  // A failure is not remembered: the next request asks again.
  value.catch(() => cache.delete(key));
  if (cache.size > CACHE_MAX) {
    for (const [k, v] of cache)
      if (now - v.at >= CACHE_TTL_MS || cache.size > CACHE_MAX) cache.delete(k);
  }
  return value;
}

/** Whether `assetId` is one of the window's placed photos: the thumbnail route's grant. */
export async function photoInWindow(
  userId: string,
  window: Span,
  assetId: string,
  deps: PhotoDeps = {}
): Promise<boolean> {
  const { photos } = await travTrackPhotos(userId, window, deps);
  return photos.some((p) => p.assetId === assetId);
}
