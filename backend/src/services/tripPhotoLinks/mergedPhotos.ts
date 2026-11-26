/**
 * Everything a trip shows as photos from its linked sources — album links and period
 * links — as ONE chronological, de-duplicated list (spec 2026-11-26-trip-photo-links.md,
 * decisions 5 and 6). Only references: each photo is a proxy URL, nothing is stored.
 *
 * De-duplication, in this order:
 *  1. the same asset of the same source reached twice (an album AND a period) is one photo;
 *  2. an Immich photo that PhotoPrism also has is dropped (`dropImmichDuplicates`): Immich
 *     holds a subset of the same pictures (owner, 2026-11-26), so an old Immich album link
 *     keeps working without showing each photo twice next to a PhotoPrism period.
 *
 * A failing source never fails the list: it is named in `failures` with its kind, so the
 * page can say which source is missing instead of showing fewer photos in silence.
 */
import { prisma } from "../../db";
import { localDay } from "../../shared/time/instant";
import { listGalleryAssets } from "../immich/albumGallery";
import { getCachedAlbumAssets } from "../immich/immichAssetCache";
import { ImmichError, type ImmichErrorKind } from "../immich/types";
import { createPhotoSource, listAllAlbumAssets, type PhotoSourceKind } from "../photoSource";
import { getPhotoSourceConnection, toPhotoSourceKind } from "../photoSource/connection";
import type { PhotoSourceAsset } from "../photoSource/types";
import { dropImmichDuplicates } from "../photoLinking/dedupe";
import {
  loadPeriodAssets,
  periodDays,
  tripPeriodContext,
  windowZones,
  type TripPeriodContext,
} from "./periods";

export interface LinkedPhotoDto {
  /** Unique across sources: `<provider>:<assetId>`, or `upload:<photoId>` for an imported copy. */
  key: string;
  provider: PhotoSourceKind;
  sourceId: string;
  sourceKind: "album" | "period";
  url: string;
  previewUrl: string;
  takenAt: string | null;
  /** Local day in the profile zone; null for an undated photo. */
  day: string | null;
}

export interface SourceFailure {
  sourceId: string;
  sourceKind: "album" | "period";
  provider: PhotoSourceKind;
  kind: ImmichErrorKind | "notConfigured";
}

interface Collected extends LinkedPhotoDto {
  /** The provider's own asset id, for rule 1 (null for imported copies). */
  assetId: string | null;
  takenMs: number | null;
  width: number | null;
  height: number | null;
}

export interface TripLinkedPhotos {
  zone: string;
  photos: LinkedPhotoDto[];
  failures: SourceFailure[];
  /** A source had more photos than one read takes; the list is a prefix of it. */
  truncated: boolean;
}

const albumProxy = (tripId: string, linkId: string, assetId: string, size: string): string =>
  `/api/v1/trips/${tripId}/immich/albums/${linkId}/assets/${assetId}/file?size=${size}`;
const periodProxy = (tripId: string, periodId: string, assetId: string, size: string): string =>
  `/api/v1/trips/${tripId}/photo-sources/${periodId}/assets/${assetId}/file?size=${size}`;

const failureKind = (error: unknown): ImmichErrorKind => {
  if (error instanceof ImmichError) return error.kind;
  throw error;
};

function fromAsset(
  asset: PhotoSourceAsset,
  base: Pick<LinkedPhotoDto, "provider" | "sourceId" | "sourceKind">,
  urlOf: (assetId: string, size: string) => string,
  zone: string
): Collected {
  const takenMs = asset.fileCreatedAt ? Date.parse(asset.fileCreatedAt) : NaN;
  return {
    ...base,
    key: `${base.provider}:${asset.id}`,
    assetId: asset.id,
    url: urlOf(asset.id, "thumbnail"),
    previewUrl: urlOf(asset.id, "preview"),
    takenAt: asset.fileCreatedAt,
    day: Number.isFinite(takenMs) ? localDay(new Date(takenMs), zone) : null,
    takenMs: Number.isFinite(takenMs) ? takenMs : null,
    width: asset.width ?? null,
    height: asset.height ?? null,
  };
}

/** Oldest first, undated last, then by key so the order is total (stable paging). */
function byTime(a: Collected, b: Collected): number {
  if (a.takenMs === null || b.takenMs === null) {
    const nulls = Number(a.takenMs === null) - Number(b.takenMs === null);
    if (nulls !== 0) return nulls;
  } else if (a.takenMs !== b.takenMs) {
    return a.takenMs - b.takenMs;
  }
  return a.key.localeCompare(b.key);
}

/** Rules 1 and 2 of the header; exported for the unit test. */
export function dedupeLinkedPhotos<T extends Collected>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    if (i.assetId === null) return true;
    const id = `${i.provider}:${i.assetId}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return dropImmichDuplicates(unique);
}

async function albumPhotos(
  userId: string,
  ctx: TripPeriodContext,
  out: Collected[],
  failures: SourceFailure[]
): Promise<boolean> {
  const tripId = ctx.trip.id;
  const links = await prisma.tripImmichAlbum.findMany({
    where: { tripId },
    orderBy: { sortIdx: "asc" },
    select: { id: true, immichAlbumId: true, mode: true, provider: true },
  });
  let truncated = false;
  await Promise.all(
    links.map(async (link) => {
      const provider = toPhotoSourceKind(link.provider);
      const base = { provider, sourceId: link.id, sourceKind: "album" as const };
      if (link.mode === "import") {
        const { assets } = await listGalleryAssets(userId, tripId, { ...link, provider }, null);
        for (const a of assets) {
          const takenMs = a.takenAt ? Date.parse(a.takenAt) : NaN;
          out.push({
            ...base,
            key: `upload:${a.id}`,
            assetId: null,
            url: a.url,
            previewUrl: a.previewUrl,
            takenAt: a.takenAt,
            day: Number.isFinite(takenMs) ? localDay(new Date(takenMs), ctx.zone) : null,
            takenMs: Number.isFinite(takenMs) ? takenMs : null,
            width: null,
            height: null,
          });
        }
        return;
      }
      const conn = await getPhotoSourceConnection(provider, userId);
      if (conn === null) {
        failures.push({ ...base, kind: "notConfigured" });
        return;
      }
      try {
        const listed = (await getCachedAlbumAssets(
          userId,
          link.immichAlbumId,
          () => listAllAlbumAssets(createPhotoSource(provider, conn), link.immichAlbumId),
          provider
        )) as PhotoSourceAsset[] & { truncated?: boolean };
        if (listed.truncated) truncated = true;
        for (const a of listed) {
          if (a.type !== "IMAGE") continue;
          out.push(
            fromAsset(a, base, (id, size) => albumProxy(tripId, link.id, id, size), ctx.zone)
          );
        }
      } catch (error) {
        failures.push({ ...base, kind: failureKind(error) });
      }
    })
  );
  return truncated;
}

async function periodPhotos(
  userId: string,
  ctx: TripPeriodContext,
  out: Collected[],
  failures: SourceFailure[]
): Promise<boolean> {
  const tripId = ctx.trip.id;
  const periods = await prisma.tripPhotoPeriod.findMany({
    where: { tripId },
    orderBy: { createdAt: "asc" },
  });
  let truncated = false;
  await Promise.all(
    periods.map(async (period) => {
      const provider = toPhotoSourceKind(period.provider);
      const base = { provider, sourceId: period.id, sourceKind: "period" as const };
      const days = periodDays(period, ctx.tripDays);
      if (days === null) return; // an undated trip with an unpinned period has no window
      try {
        const assets = await loadPeriodAssets(userId, provider, days, windowZones(ctx));
        if (assets === null) {
          failures.push({ ...base, kind: "notConfigured" });
          return;
        }
        if (assets.truncated) truncated = true;
        for (const a of assets) {
          out.push(
            fromAsset(a, base, (id, size) => periodProxy(tripId, period.id, id, size), ctx.zone)
          );
        }
      } catch (error) {
        failures.push({ ...base, kind: failureKind(error) });
      }
    })
  );
  return truncated;
}

/** The merged list of the caller's trip, or null when the trip is not theirs. */
export async function loadTripLinkedPhotos(
  userId: string,
  tripId: string
): Promise<TripLinkedPhotos | null> {
  const ctx = await tripPeriodContext(userId, tripId);
  if (ctx === null) return null;
  const collected: Collected[] = [];
  const failures: SourceFailure[] = [];
  // Albums first: on rule 1 the first reach of an asset wins, and an album's proxy
  // URL stays valid when a period is removed.
  const albumTruncated = await albumPhotos(userId, ctx, collected, failures);
  const periodTruncated = await periodPhotos(userId, ctx, collected, failures);
  const photos = dedupeLinkedPhotos(collected)
    .sort(byTime)
    .map(({ assetId: _a, takenMs: _t, width: _w, height: _h, ...dto }) => dto);
  return {
    zone: ctx.zone,
    photos,
    failures: failures.sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    truncated: albumTruncated || periodTruncated,
  };
}
