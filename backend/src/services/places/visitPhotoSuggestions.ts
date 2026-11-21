import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { EARTH_RADIUS_KM, haversineKm } from "../../shared/geo/haversine";
import { VISIT_PHOTO_SUGGESTION_CAP } from "../../schemas/place";
import { localDay, withinKm } from "../../utils/sqlGeo";
import { localDay as localDayAt } from "../../shared/time/instant";
import { startOfDayAt } from "../../shared/time/legacyValues";
import { zoneOf } from "../../shared/time/zoneOf";
import { getCachedAlbumAssets, peekCachedAlbumAssets } from "../immich/immichAssetCache";
import {
  aggregateState,
  candidatesForWindow,
  NotConfigured,
  type SourceState,
  type SourcedAsset,
  type WindowSearch,
} from "../photoLinking/matcher";
import { createPhotoSource, type PhotoSourceKind } from "../photoSource";
import { getPhotoSourceConnection, toPhotoSourceKind } from "../photoSource/connection";
import { PHOTO_RADIUS_KM } from "./visitDateSuggestions";
import { linkAssetsToVisit } from "./visitPhotoLinks";
import { refusedIds } from "./visitPhotoRefusals";
import { refusalKey } from "../photoLinking/matcher";

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

export type LibraryState = SourceState;

export interface VisitPhotoSuggestion {
  kind: "trip" | "library";
  /** The trip photo id, or the Immich asset id. */
  id: string;
  url: string;
  takenAt: string | null;
  distanceM: number;
  /** The photo source of a `library` suggestion; absent on a trip photo. */
  provider?: PhotoSourceKind;
}

export interface VisitPhotoSuggestions {
  /** The visit's day, `YYYY-MM-DD`; null for an undated visit, which gets none. */
  day: string | null;
  suggestions: VisitPhotoSuggestion[];
  /** The worst-case answer over all sources: "ok" when any source answered. */
  library: LibraryState;
  /** Each source's own answer, so one failing source is visible beside the other. */
  sources: Partial<Record<PhotoSourceKind, LibraryState>>;
}

export interface VisitAnchor {
  id: string;
  day: string;
  tz: string | null;
  lat: number;
  lon: number;
}

/** The caller's visit with the facts a search needs, or null when it is not theirs. */
export async function anchorOf(
  userId: string,
  visitId: string
): Promise<VisitAnchor | "undated" | null> {
  const visit = await prisma.placeVisit.findFirst({
    where: { id: visitId, userId },
    select: {
      id: true,
      visitedAt: true,
      visitedAtUtc: true,
      visitedZone: true,
      place: { select: { lat: true, lon: true } },
    },
  });
  if (!visit) return null;
  if (!visit.visitedAt) return "undated";
  const { lat, lon } = visit.place;
  // The zone stored with the visit, else the place's (ADR 0002 D2). The day
  // is read from the visit's instant on that clock; `visited_at` is a mixed
  // legacy column (web wall clock vs Companion instant) and only answers for a
  // visit the backfill has not reached — its date, which is what Q4 keeps.
  const tz = visit.visitedZone ?? zoneOf({ lat, lon });
  const day =
    visit.visitedAtUtc && tz
      ? localDayAt(visit.visitedAtUtc, tz)
      : visit.visitedAt.toISOString().slice(0, 10);
  return { id: visit.id, day, tz, lat, lon };
}

interface TripPhotoRow {
  id: string;
  tripId: string;
  takenAt: Date | null;
  immichAssetId: string | null;
  provider: string;
  distanceKm: number;
}

/** The caller's trip photos of that day near the place, not yet linked to the visit. */
async function tripPhotosNear(userId: string, a: VisitAnchor): Promise<TripPhotoRow[]> {
  return prisma.$queryRaw<TripPhotoRow[]>(Prisma.sql`
    SELECT ph.id, ph.trip_id AS "tripId", ph.taken_at AS "takenAt",
           ph.immich_asset_id AS "immichAssetId", ph.provider AS "provider",
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
          AND (v.trip_photo_id = ph.id
               OR (v.immich_asset_id = ph.immich_asset_id AND v.provider = ph.provider))
      )
      -- Refused for this visit ("Nicht diese"): left out in SQL, so a refusal
      -- does not eat into the cap and hide a photo that was never refused.
      AND NOT EXISTS (
        SELECT 1 FROM visit_photo_refusals r
        WHERE r.place_visit_id = ${a.id} AND r.kind = 'trip' AND r.suggestion_id = ph.id
      )
    ORDER BY ph.taken_at ASC
    LIMIT ${SUGGESTION_CAP}
  `);
}

export const dayCacheKey = (a: VisitAnchor): string => `visit-day:${a.id}:${a.day}`;

const HOUR_MS = 3_600_000;

/**
 * The instants the visit's day covers: its start and end on the place's
 * clock. A place with no zone (open water) has no single answer, so the
 * search spans the day as ANY clock on Earth knew it (UTC−12 … UTC+14) —
 * the radius filter then keeps only what was taken there. Never the UTC day
 * alone, which silently drops a morning in Auckland or an evening in Hawaii.
 */
export function dayWindow(a: VisitAnchor): { start: Date; end: Date } {
  if (a.tz) {
    const start = startOfDayAt(a.day, a.tz);
    return { start, end: new Date(start.getTime() + 24 * HOUR_MS - 1) };
  }
  const utcMidnight = Date.parse(`${a.day}T00:00:00.000Z`);
  return {
    start: new Date(utcMidnight - 14 * HOUR_MS),
    end: new Date(utcMidnight + 36 * HOUR_MS - 1),
  };
}

function nearTheAnchor(a: VisitAnchor, day: SourcedAsset[]): SourcedAsset[] {
  return day.filter(
    ({ asset }) =>
      asset.lat !== null &&
      asset.lon !== null &&
      haversineKm(a, { lat: asset.lat, lon: asset.lon }) <= PHOTO_RADIUS_KM
  );
}

/**
 * The day's search of one source, cached per visit, day AND source for the
 * asset cache's minute. A source with no connection throws `NotConfigured`,
 * which `candidatesForWindow` records as that source's state.
 */
function cachedDaySearch(userId: string, a: VisitAnchor): WindowSearch {
  return async (provider, window) => {
    const connection = await getPhotoSourceConnection(provider, userId);
    if (connection === null) throw new NotConfigured();
    const source = createPhotoSource(provider, connection);
    return getCachedAlbumAssets(
      userId,
      dayCacheKey(a),
      async () => {
        const page = await source.searchAssetsByTime({
          takenAfter: window.start,
          takenBefore: window.end,
        });
        return page.assets;
      },
      provider
    );
  };
}

/**
 * The photographs of the visit's day within the photo radius, from every
 * connected photo source (Immich and PhotoPrism).
 *
 * This is also the PROOF every later step relies on: a library id is only ever
 * shown, streamed or linked when it is in this list, which the server built
 * from the caller's own connection. Cached per visit, day and source for the
 * asset cache's minute, so the thumbnails and the link that follow the listing
 * do not search the library again.
 */
export async function libraryAssetsNear(
  userId: string,
  a: VisitAnchor
): Promise<{
  state: LibraryState;
  sources: Partial<Record<PhotoSourceKind, LibraryState>>;
  assets: SourcedAsset[];
}> {
  const { sources, candidates } = await candidatesForWindow(
    cachedDaySearch(userId, a),
    dayWindow(a)
  );
  return { state: aggregateState(sources), sources, assets: nearTheAnchor(a, candidates) };
}

function libraryUrl(visitId: string, provider: PhotoSourceKind, assetId: string): string {
  const base = `/api/v1/places/visits/${visitId}/photo-suggestions/library/${assetId}/file`;
  return provider === "immich" ? base : `${base}?provider=${provider}`;
}

export async function visitPhotoSuggestionsFor(
  userId: string,
  visitId: string
): Promise<VisitPhotoSuggestions | null> {
  const anchor = await anchorOf(userId, visitId);
  if (anchor === null) return null;
  if (anchor === "undated") return { day: null, suggestions: [], library: "ok", sources: {} };

  const [tripRows, library, linked, refused] = await Promise.all([
    tripPhotosNear(userId, anchor),
    libraryAssetsNear(userId, anchor),
    prisma.placeVisitPhoto.findMany({
      where: { placeVisitId: visitId, immichAssetId: { not: null } },
      select: { immichAssetId: true, provider: true },
    }),
    refusedIds(visitId),
  ]);

  const fromTrips: VisitPhotoSuggestion[] = tripRows.map((row) => ({
    kind: "trip",
    id: row.id,
    url: `/api/v1/trips/${row.tripId}/photos/${row.id}/file`,
    takenAt: row.takenAt?.toISOString() ?? null,
    distanceM: Math.round(row.distanceKm * 1000),
  }));
  // A library photo that is already a trip photo, or already on the visit, is
  // the same picture twice; one refused for this visit is not offered again.
  const seen = new Set<string>([
    ...refused.library,
    ...tripRows.flatMap((row) =>
      row.immichAssetId ? [refusalKey(toPhotoSourceKind(row.provider), row.immichAssetId)] : []
    ),
    ...linked.flatMap((row) =>
      row.immichAssetId ? [refusalKey(toPhotoSourceKind(row.provider), row.immichAssetId)] : []
    ),
  ]);
  const fromLibrary: VisitPhotoSuggestion[] = library.assets
    .filter(({ provider, asset }) => !seen.has(refusalKey(provider, asset.id)))
    .slice(0, SUGGESTION_CAP)
    .map(({ provider, asset }) => ({
      kind: "library",
      id: asset.id,
      provider,
      url: libraryUrl(visitId, provider, asset.id),
      takenAt: asset.fileCreatedAt,
      distanceM: Math.round(haversineKm(anchor, { lat: asset.lat!, lon: asset.lon! }) * 1000),
    }));

  return {
    day: anchor.day,
    suggestions: [...fromTrips, ...fromLibrary],
    library: library.state,
    sources: library.sources,
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
  assetId: string,
  provider: PhotoSourceKind = "immich"
): Promise<boolean | null> {
  const anchor = await anchorOf(userId, visitId);
  if (anchor === null || anchor === "undated") return null;
  const day = await peekCachedAlbumAssets(userId, dayCacheKey(anchor), provider);
  if (day === null) return false;
  return nearTheAnchor(
    anchor,
    day.map((asset) => ({ provider, asset }))
  ).some(({ asset }) => asset.id === assetId);
}

export interface LinkPicks {
  tripPhotoIds: string[];
  assetIds: string[];
  /** Source of `assetIds`; Immich when absent (the Companion's older calls). */
  provider?: PhotoSourceKind;
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

  const provider = picks.provider ?? "immich";
  let proven: SourcedAsset[] = [];
  if (picks.assetIds.length > 0 && anchor !== "undated") {
    const { assets } = await libraryAssetsNear(userId, anchor);
    const wanted = new Set(picks.assetIds);
    proven = assets.filter((c) => c.provider === provider && wanted.has(c.asset.id));
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
  const linkedLibrary = await linkAssetsToVisit(visitId, proven, "manual");

  // Skipped = refused: not the caller's photo, or not among the proven
  // suggestions. A pick that was already linked is neither linked nor skipped.
  return {
    linked: freshTrip.length + linkedLibrary,
    skipped: picks.tripPhotoIds.length - owned.length + (picks.assetIds.length - proven.length),
  };
}
