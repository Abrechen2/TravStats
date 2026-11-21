import { prisma } from "../../db";
import { ImmichError, type ImmichConnection } from "../immich/types";
import { historyGeneration } from "../locationEvidence/generation";
import {
  PHOTO_SOURCE_KINDS,
  createPhotoSource,
  listAllAlbumAssets,
  type PhotoSourceKind,
  type PhotoSourceProvider,
} from "../photoSource";
import { getPhotoSourceConnection } from "../photoSource/connection";
import type { PhotoSourceAsset } from "../photoSource/types";
import type { StoredPoint } from "../tripRecording/segments";
import logger from "../../utils/logger";
import { inPrivacyZone, type ZoneCircle } from "./classify";
import { linkedAlbumsOf, type LinkedAlbums } from "./photosLinkedAlbums";
import { readSafeTravTrack, type SafeCursor, type Span } from "./readSafe";

/**
 * Photos taken during a window, placed on the account's own track (TravTrack
 * plan T5.3, the flight panel and the map): every photo source the account
 * has connected (Immich, PhotoPrism; each resolves user → admin-global → ENV)
 * is asked for the assets taken in the window, plus the window's trips' linked
 * albums of either source, and each asset is placed by its capture TIME on the
 * privacy-safe track (`readSafe.ts`) — between the two consecutive vertices of
 * one stretch around it. Assets are identified by provider + id and deduped on
 * that pair; one source failing never hides the other's photos (`failures`).
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
 * generation for a minute, so a grid of thumbnails costs one search per source;
 * a new zone or a deletion raises the generation and with it the key.
 */

/** The longest window one request asks Immich about. */
export const PHOTO_WINDOW_MAX_MS = 7 * 86_400_000;
const READ_PAGE = 50_000;
const MAX_READ_PAGES = 10;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

export type TravTrackPhoto = {
  provider: PhotoSourceKind;
  assetId: string;
  type: "IMAGE" | "VIDEO";
  takenAt: string;
  /** On the privacy-safe track at `takenAt`; never the photo's own EXIF. */
  lat: number;
  lon: number;
};

export type TravTrackPhotos = {
  photos: TravTrackPhoto[];
  /**
   * Not every photo of the window could be considered: Immich held more than
   * one search returns, or the track was longer than one answer reads
   * (`trackTruncated`). A shorter window shows the rest.
   */
  truncated: boolean;
  /** The window's track was longer than the read bound: photos after its read part are not placed. */
  trackTruncated: boolean;
  /** Sources that could not answer (their photos are missing); the others' photos are in `photos`. */
  failures: TravTrackPhotoFailure[];
};

export type TravTrackPhotoFailure = {
  provider: PhotoSourceKind;
  /** The fixed `ImmichErrorKind` vocabulary. */
  kind: ImmichError["kind"];
};

type TimeSource = Pick<PhotoSourceProvider, "searchAssetsByTime" | "listAlbumAssets">;

export type PhotoDeps = {
  /** The connected sources of the account; a source without a connection is simply absent. */
  connections?: (userId: string) => Promise<Partial<Record<PhotoSourceKind, ImmichConnection>>>;
  source?: (kind: PhotoSourceKind, conn: ImmichConnection) => TimeSource;
  /** Test seam: the trips' linked albums of the window. */
  albums?: (userId: string, window: Span) => Promise<LinkedAlbums>;
  /** Test seam: the track read's page size and page bound. */
  readLimits?: { page: number; pages: number };
};

/** No photo source resolves for the account. */
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

/**
 * The window's safe stretches, page by page (each page's stretches stand
 * alone). `complete` is false when the page bound ran out before the window
 * did: the rest of the track is not read, and the answer must say so.
 */
async function safeStretches(
  userId: string,
  window: Span,
  limits: { page: number; pages: number } = { page: READ_PAGE, pages: MAX_READ_PAGES }
) {
  const stretches: StoredPoint[][] = [];
  const circles: ZoneCircle[] = [];
  let cursor: SafeCursor | null = null;
  let complete = false;
  for (let page = 0; page < limits.pages; page++) {
    const read = await readSafeTravTrack(userId, window, limits.page, cursor);
    stretches.push(...read.segments);
    if (page === 0) circles.push(...read.circles);
    if (!read.next || !read.cursor) {
      complete = true;
      break;
    }
    cursor = read.cursor;
  }
  return { stretches, circles, complete };
}

const cache = new Map<string, { at: number; value: Promise<TravTrackPhotos> }>();

/** Test seam: forget every cached window. */
export function clearTravTrackPhotoCache(): void {
  cache.clear();
}

/** Every source answered with a failure and none has a photo to show. */
export class PhotoSourcesFailed extends Error {
  constructor(readonly failures: TravTrackPhotoFailure[]) {
    super("No photo source answered");
  }
}

async function connectionsOf(
  userId: string
): Promise<Partial<Record<PhotoSourceKind, ImmichConnection>>> {
  const found: Partial<Record<PhotoSourceKind, ImmichConnection>> = {};
  for (const kind of PHOTO_SOURCE_KINDS) {
    const conn = await getPhotoSourceConnection(kind, userId);
    if (conn) found[kind] = conn;
  }
  return found;
}

type Gathered = {
  assets: PhotoSourceAsset[];
  truncated: boolean;
  failure: ImmichError["kind"] | null;
  /** The library search itself answered (an album failing does not undo it). */
  searched: boolean;
};

/**
 * One source's assets of the window: its library search plus the trips'
 * linked albums that live on it. The two reads are independent — an album that
 * cannot be read does not hide the search's photos, and the other way round —
 * and the first failure's kind is reported.
 */
async function gather(
  kind: PhotoSourceKind,
  source: TimeSource,
  albums: readonly LinkedAlbums["albums"][number][],
  window: Span
): Promise<Gathered> {
  const out: Gathered = { assets: [], truncated: false, failure: null, searched: false };
  const fail = (error: unknown) => {
    // Anything but the fixed vocabulary is a bug, not a source being down.
    if (!(error instanceof ImmichError)) throw error;
    out.failure ??= error.kind;
    logger.warn({
      message: "travtrack_photos_source_failure",
      context: { provider: kind, kind: error.kind },
    });
  };
  try {
    // Both ranges are inclusive; the window's end is not.
    const found = await source.searchAssetsByTime({
      takenAfter: new Date(window.fromMs),
      takenBefore: new Date(window.untilMs - 1),
    });
    out.assets.push(...found.assets);
    out.truncated ||= found.truncated;
    out.searched = true;
  } catch (error) {
    fail(error);
  }
  for (const album of albums) {
    if (album.provider !== kind) continue;
    try {
      const list = await listAllAlbumAssets(source, album.albumId);
      out.assets.push(...list);
      out.truncated ||= list.truncated === true;
    } catch (error) {
      fail(error);
    }
  }
  return out;
}

async function computePhotos(
  userId: string,
  window: Span,
  conns: Partial<Record<PhotoSourceKind, ImmichConnection>>,
  deps: PhotoDeps
): Promise<TravTrackPhotos> {
  const kinds = PHOTO_SOURCE_KINDS.filter((k) => conns[k]);
  const { albums, truncated: albumsOmitted } = await (deps.albums ?? linkedAlbumsOf)(
    userId,
    window
  );
  const [{ stretches, circles, complete }, gathered] = await Promise.all([
    safeStretches(userId, window, deps.readLimits),
    Promise.all(
      kinds.map((kind) =>
        gather(kind, (deps.source ?? createPhotoSource)(kind, conns[kind]!), albums, window)
      )
    ),
  ]);
  const photos = new Map<string, TravTrackPhoto>();
  const failures: TravTrackPhotoFailure[] = [];
  let truncated = !complete || albumsOmitted;
  gathered.forEach((g, i) => {
    const provider = kinds[i];
    truncated ||= g.truncated;
    if (g.failure) failures.push({ provider, kind: g.failure });
    for (const asset of g.assets) {
      const key = `${provider}:${asset.id}`;
      if (photos.has(key)) continue;
      // An undated photo has no moment to place on the track (null, never 1970).
      if (asset.fileCreatedAt === null) continue;
      const t = Date.parse(asset.fileCreatedAt);
      if (!Number.isFinite(t) || t < window.fromMs || t >= window.untilMs) continue;
      // By TIME on the safe track — never the asset's own coordinates.
      const at = positionAt(stretches, circles, t);
      if (!at) continue;
      photos.set(key, {
        provider,
        assetId: asset.id,
        type: asset.type,
        takenAt: new Date(t).toISOString(),
        ...at,
      });
    }
  });
  if (photos.size === 0 && gathered.every((g) => !g.searched))
    throw new PhotoSourcesFailed(failures);
  const list = [...photos.values()].sort(
    (a, b) =>
      a.takenAt.localeCompare(b.takenAt) ||
      a.provider.localeCompare(b.provider) ||
      a.assetId.localeCompare(b.assetId)
  );
  return { photos: list, truncated, trackTruncated: !complete, failures };
}

/**
 * The window's photos with a safe position. Throws `PhotosNotConfigured`
 * without any connection and `PhotoSourcesFailed` when every source failed
 * (`failures` carry the `ImmichErrorKind`s the route answers with).
 */
export async function travTrackPhotos(
  userId: string,
  window: Span,
  deps: PhotoDeps = {}
): Promise<TravTrackPhotos> {
  const conns = await (deps.connections ?? connectionsOf)(userId);
  if (PHOTO_SOURCE_KINDS.every((k) => !conns[k])) throw new PhotosNotConfigured();
  const generation = await historyGeneration(prisma, userId);
  const limits = deps.readLimits ? `|${deps.readLimits.page}x${deps.readLimits.pages}` : "";
  const sources = PHOTO_SOURCE_KINDS.map((k) =>
    conns[k] ? `${k}@${conns[k].source}@${conns[k].baseUrl}` : `${k}@-`
  ).join(",");
  const key = `${userId}|${window.fromMs}|${window.untilMs}|${generation}|${sources}${limits}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  const value = computePhotos(userId, window, conns, deps);
  cache.set(key, { at: now, value });
  // A failure is not remembered: the next request asks again.
  value.catch(() => cache.delete(key));
  if (cache.size > CACHE_MAX) {
    for (const [k, v] of cache)
      if (now - v.at >= CACHE_TTL_MS || cache.size > CACHE_MAX) cache.delete(k);
  }
  return value;
}

/** Whether `provider`'s `assetId` is one of the window's placed photos: the thumbnail route's grant. */
export async function photoInWindow(
  userId: string,
  window: Span,
  provider: PhotoSourceKind,
  assetId: string,
  deps: PhotoDeps = {}
): Promise<boolean> {
  const { photos } = await travTrackPhotos(userId, window, deps);
  return photos.some((p) => p.provider === provider && p.assetId === assetId);
}
