import { fromZonedTime } from "date-fns-tz";

import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { EARTH_RADIUS_KM, haversineKm } from "../../shared/geo/haversine";
import { VISIT_PHOTO_SUGGESTION_CAP } from "../../schemas/place";
import { localDay, withinKm } from "../../utils/sqlGeo";
import { timezoneOfLodging } from "../../utils/stayInstant";
import { createImmichClient } from "../immich/immichClient";
import { getCachedAlbumAssets, peekCachedAlbumAssets } from "../immich/immichAssetCache";
import { getImmichConnection } from "../immich/immichResolver";
import { ImmichError, type ImmichAsset, type ImmichErrorKind } from "../immich/types";
import { PHOTO_RADIUS_KM } from "./visitDateSuggestions";
import { linkImmichAssetsToVisit } from "./visitPhotoLinks";

/**
 * Photographs a place visit could show, found in the user's own records
 * (package 9, item 2): their trip photos taken that day within a few hundred
 * metres of the place, and — with an Immich connection — the library's photos
 * of that day whose EXIF position is as close.
 *
 * "That day" is the visit's own calendar day. `visitedAt` is the local wall
 * clock at the place (see the schema), so its date needs no conversion; the
 * photographs are instants and are read in the place's zone.
 *
 * A suggestion is offered, never attached: the user picks, and the pick is a
 * LINK — a trip photo stays one file, a library photo stays in Immich.
 */

/** Suggestions of each kind at most; a day at a sight can hold hundreds. */
const SUGGESTION_CAP = VISIT_PHOTO_SUGGESTION_CAP;

export type LibraryState = "ok" | "notConfigured" | ImmichErrorKind;

export interface VisitPhotoSuggestion {
  kind: "trip" | "library";
  /** The trip photo id, or the Immich asset id. */
  id: string;
  url: string;
  takenAt: string | null;
  distanceM: number;
}

export interface VisitPhotoSuggestions {
  /** The visit's day, `YYYY-MM-DD`; null for an undated visit, which gets none. */
  day: string | null;
  suggestions: VisitPhotoSuggestion[];
  library: LibraryState;
}

interface VisitAnchor {
  id: string;
  day: string;
  tz: string | null;
  lat: number;
  lon: number;
}

/** The caller's visit with the facts a search needs, or null when it is not theirs. */
async function anchorOf(userId: string, visitId: string): Promise<VisitAnchor | "undated" | null> {
  const visit = await prisma.placeVisit.findFirst({
    where: { id: visitId, userId },
    select: { id: true, visitedAt: true, place: { select: { lat: true, lon: true } } },
  });
  if (!visit) return null;
  if (!visit.visitedAt) return "undated";
  const { lat, lon } = visit.place;
  return {
    id: visit.id,
    day: visit.visitedAt.toISOString().slice(0, 10),
    tz: timezoneOfLodging(lat, lon),
    lat,
    lon,
  };
}

interface TripPhotoRow {
  id: string;
  tripId: string;
  takenAt: Date | null;
  immichAssetId: string | null;
  distanceKm: number;
}

/** The caller's trip photos of that day near the place, not yet linked to the visit. */
async function tripPhotosNear(userId: string, a: VisitAnchor): Promise<TripPhotoRow[]> {
  return prisma.$queryRaw<TripPhotoRow[]>(Prisma.sql`
    SELECT ph.id, ph.trip_id AS "tripId", ph.taken_at AS "takenAt",
           ph.immich_asset_id AS "immichAssetId",
           ${EARTH_RADIUS_KM}::float8 * 2 * asin(sqrt(
             power(sin(radians(ph.lat - ${a.lat}::float8) / 2), 2)
             + cos(radians(${a.lat}::float8)) * cos(radians(ph.lat))
               * power(sin(radians(ph.lon - ${a.lon}::float8) / 2), 2)
           )) AS "distanceKm"
    FROM trip_photos ph
    JOIN trips t ON t.id = ph.trip_id
    WHERE t.user_id = ${userId}
      AND ph.caption IS DISTINCT FROM '__cover__'
      AND ph.taken_at IS NOT NULL
      AND ph.lat IS NOT NULL AND ph.lon IS NOT NULL
      AND ${withinKm(Prisma.sql`ph.lat`, Prisma.sql`ph.lon`, a, PHOTO_RADIUS_KM)}
      AND ${localDay(Prisma.sql`ph.taken_at`, a.tz)} = ${a.day}
      AND NOT EXISTS (
        SELECT 1 FROM place_visit_photos v
        WHERE v.place_visit_id = ${a.id}
          AND (v.trip_photo_id = ph.id OR v.immich_asset_id = ph.immich_asset_id)
      )
    ORDER BY ph.taken_at ASC
    LIMIT ${SUGGESTION_CAP}
  `);
}

const dayCacheKey = (a: VisitAnchor): string => `visit-day:${a.id}:${a.day}`;

function nearTheAnchor(a: VisitAnchor, day: ImmichAsset[]): ImmichAsset[] {
  return day.filter(
    (asset) =>
      asset.lat !== null &&
      asset.lon !== null &&
      haversineKm(a, { lat: asset.lat, lon: asset.lon }) <= PHOTO_RADIUS_KM
  );
}

/**
 * The library's photographs of the visit's day within the photo radius.
 *
 * This is also the PROOF every later step relies on: a library id is only ever
 * shown, streamed or linked when it is in this list, which the server built
 * from the caller's own connection. Cached per visit and day for the asset
 * cache's minute, so the thumbnails and the link that follow the listing do
 * not search the library again.
 */
export async function libraryAssetsNear(
  userId: string,
  a: VisitAnchor
): Promise<{ state: LibraryState; assets: ImmichAsset[] }> {
  const connection = await getImmichConnection(userId);
  if (connection === null) return { state: "notConfigured", assets: [] };
  const client = createImmichClient(connection);
  const start = fromZonedTime(`${a.day}T00:00:00`, a.tz ?? "UTC");
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  try {
    const day = await getCachedAlbumAssets(userId, dayCacheKey(a), async () => {
      const page = await client.searchAssetsByDate({ takenAfter: start, takenBefore: end });
      return page.assets;
    });
    return { state: "ok", assets: nearTheAnchor(a, day) };
  } catch (error) {
    if (error instanceof ImmichError) return { state: error.kind, assets: [] };
    throw error;
  }
}

function libraryUrl(visitId: string, assetId: string): string {
  return `/api/v1/places/visits/${visitId}/photo-suggestions/library/${assetId}/file`;
}

export async function visitPhotoSuggestionsFor(
  userId: string,
  visitId: string
): Promise<VisitPhotoSuggestions | null> {
  const anchor = await anchorOf(userId, visitId);
  if (anchor === null) return null;
  if (anchor === "undated") return { day: null, suggestions: [], library: "ok" };

  const [tripRows, library, linked] = await Promise.all([
    tripPhotosNear(userId, anchor),
    libraryAssetsNear(userId, anchor),
    prisma.placeVisitPhoto.findMany({
      where: { placeVisitId: visitId, immichAssetId: { not: null } },
      select: { immichAssetId: true },
    }),
  ]);

  const fromTrips: VisitPhotoSuggestion[] = tripRows.map((row) => ({
    kind: "trip",
    id: row.id,
    url: `/api/v1/trips/${row.tripId}/photos/${row.id}/file`,
    takenAt: row.takenAt?.toISOString() ?? null,
    distanceM: Math.round(row.distanceKm * 1000),
  }));
  // A library photo that is already a trip photo, or already on the visit, is
  // the same picture twice.
  const seen = new Set<string>([
    ...tripRows.flatMap((row) => (row.immichAssetId ? [row.immichAssetId] : [])),
    ...linked.flatMap((row) => (row.immichAssetId ? [row.immichAssetId] : [])),
  ]);
  const fromLibrary: VisitPhotoSuggestion[] = library.assets
    .filter((asset) => !seen.has(asset.id))
    .slice(0, SUGGESTION_CAP)
    .map((asset) => ({
      kind: "library",
      id: asset.id,
      url: libraryUrl(visitId, asset.id),
      takenAt: asset.fileCreatedAt,
      distanceM: Math.round(haversineKm(anchor, { lat: asset.lat!, lon: asset.lon! }) * 1000),
    }));

  return {
    day: anchor.day,
    suggestions: [...fromTrips, ...fromLibrary],
    library: library.state,
  };
}

/**
 * Whether one library asset is among the visit's suggestions — the check the
 * thumbnail proxy makes before it streams anything. Null when the visit is not
 * the caller's (or has no day, which suggests nothing).
 *
 * It only reads the day search the LISTING left in the cache and never runs
 * one: the proxy sits on the generous thumbnail bucket, and a search per tile
 * request would let one account drive hundreds of full-day library searches a
 * minute against what may be a shared connection. The strip requests its
 * tiles right after the listing; a tile asked for once the cache's minute is
 * over is a 404 until the suggestions are opened again.
 */
export async function isSuggestedLibraryAsset(
  userId: string,
  visitId: string,
  assetId: string
): Promise<boolean | null> {
  const anchor = await anchorOf(userId, visitId);
  if (anchor === null || anchor === "undated") return null;
  const day = await peekCachedAlbumAssets(userId, dayCacheKey(anchor));
  if (day === null) return false;
  return nearTheAnchor(anchor, day).some((asset) => asset.id === assetId);
}

export interface LinkPicks {
  tripPhotoIds: string[];
  assetIds: string[];
}

/**
 * Link what the user picked. A trip photo must be the caller's; a library id
 * must be in the visit's proven suggestions. Anything else is skipped and
 * counted rather than failing the whole pick. Idempotent.
 */
export async function linkPickedPhotos(
  userId: string,
  visitId: string,
  picks: LinkPicks
): Promise<{ linked: number; skipped: number } | null> {
  const anchor = await anchorOf(userId, visitId);
  if (anchor === null) return null;

  const owned = await prisma.tripPhoto.findMany({
    where: { id: { in: picks.tripPhotoIds }, trip: { userId } },
    select: { id: true, mimetype: true },
  });
  const already = await prisma.placeVisitPhoto.findMany({
    where: { placeVisitId: visitId, tripPhotoId: { in: owned.map((p) => p.id) } },
    select: { tripPhotoId: true },
  });
  const known = new Set(already.map((row) => row.tripPhotoId));
  const freshTrip = owned.filter((p) => !known.has(p.id));

  let proven: ImmichAsset[] = [];
  if (picks.assetIds.length > 0 && anchor !== "undated") {
    const { assets } = await libraryAssetsNear(userId, anchor);
    const wanted = new Set(picks.assetIds);
    proven = assets.filter((asset) => wanted.has(asset.id));
  }

  if (freshTrip.length > 0) {
    const last = await prisma.placeVisitPhoto.findFirst({
      where: { placeVisitId: visitId },
      orderBy: { sortIdx: "desc" },
      select: { sortIdx: true },
    });
    const base = (last?.sortIdx ?? -1) + 1;
    await prisma.placeVisitPhoto.createMany({
      data: freshTrip.map((photo, i) => ({
        placeVisitId: visitId,
        filename: null,
        mimetype: photo.mimetype,
        sizeBytes: 0,
        tripPhotoId: photo.id,
        sortIdx: base + i,
      })),
    });
  }
  const linkedLibrary = await linkImmichAssetsToVisit(visitId, proven);

  // Skipped = refused: not the caller's photo, or not among the proven
  // suggestions. A pick that was already linked is neither linked nor skipped.
  return {
    linked: freshTrip.length + linkedLibrary,
    skipped: picks.tripPhotoIds.length - owned.length + (picks.assetIds.length - proven.length),
  };
}
