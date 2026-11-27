import { prisma } from "../../db";
import logger from "../../utils/logger";
import { createImmichClient } from "../immich/immichClient";
import { getCachedAlbumAssets } from "../immich/immichAssetCache";
import { getImmichConnection } from "../immich/immichResolver";
import { ImmichError, type ImmichAsset, type ImmichErrorKind } from "../immich/types";
import type { SourcedAsset } from "../photoLinking/matcher";
import { createPhotoSource } from "../photoSource";
import { getPhotoSourceConnection } from "../photoSource/connection";
import type { PhotoSourceAsset } from "../photoSource/types";
import { haversineKm } from "../../shared/geo/haversine";
import { VISIT_STOP_OPTIONS } from "../photoJourneys/visitStops";

/**
 * Library photographs attached to a place visit as LINKS — a row that carries
 * `immichAssetId` and no file, streamed by the visit photo route (forgejo#21).
 *
 * An asset id is never taken on trust, wherever it came from. Before a row is
 * written, the id must turn up in a search the server itself runs against the
 * caller's own Immich connection. The visit photo route streams whatever id a
 * row holds, so a row is a grant — and a grant for an id the caller's library
 * never showed them would turn linking into reading someone else's photos
 * (the shared/global connection makes that more than theoretical).
 */

export type AttachOutcome =
  | { kind: "notConfigured" }
  | { kind: "failed"; reason: ImmichErrorKind }
  | {
      kind: "linked";
      linked: number;
      skipped: number;
      /** A library that failed while another one linked (#414: Immich and PhotoPrism). */
      failedSources?: Array<{ provider: "immich" | "photoprism"; reason: ImmichErrorKind }>;
    };

/** A journey's first and last photo bound the search; a minute either side absorbs rounding. */
const JOURNEY_SEARCH_PAD_MS = 60_000;

/**
 * Write link rows for `assets` on the visit, skipping any already linked there
 * (by source and asset id). Idempotent, so a retried accept, a double click or
 * a second automatic pass adds nothing twice. `provenance` records who linked
 * it: the user (`manual`) or the matcher (`auto`).
 */
export async function linkAssetsToVisit(
  visitId: string,
  assets: SourcedAsset[],
  provenance: "manual" | "auto",
  max: number = Number.POSITIVE_INFINITY
): Promise<number> {
  if (assets.length === 0) return 0;
  const existing = await prisma.placeVisitPhoto.findMany({
    where: { placeVisitId: visitId, immichAssetId: { in: assets.map((a) => a.asset.id) } },
    select: { immichAssetId: true, provider: true },
  });
  const known = new Set(existing.map((row) => `${row.provider}:${row.immichAssetId}`));
  const fresh = assets.filter((a) => !known.has(`${a.provider}:${a.asset.id}`)).slice(0, max);
  if (fresh.length === 0) return 0;

  const last = await prisma.placeVisitPhoto.findFirst({
    where: { placeVisitId: visitId },
    orderBy: { sortIdx: "desc" },
    select: { sortIdx: true },
  });
  const base = (last?.sortIdx ?? -1) + 1;
  const { count } = await prisma.placeVisitPhoto.createMany({
    data: fresh.map(({ provider, asset }, i) => ({
      placeVisitId: visitId,
      filename: null,
      mimetype: asset.mimeType,
      // Zero bytes stored here; the column describes what we hold, not the source.
      sizeBytes: 0,
      immichAssetId: asset.id,
      provider,
      provenance,
      takenAt: asset.fileCreatedAt ? new Date(asset.fileCreatedAt) : null,
      sortIdx: base + i,
    })),
    // Two passes racing on the same visit: the unique key decides, not a throw.
    skipDuplicates: true,
  });
  return count;
}

/** The journey preview's Immich assets, as links the user accepted. */
export async function linkImmichAssetsToVisit(
  visitId: string,
  assets: ImmichAsset[]
): Promise<number> {
  return linkAssetsToVisit(
    visitId,
    assets.map((asset) => ({ provider: "immich" as const, asset })),
    "manual"
  );
}

/**
 * Accepting a place finding brings its photographs along (package 9, item 1).
 *
 * The preview ids on the journey row were written by a scan of this user's
 * library, but the row is data and the check is cheap: the journey's own time
 * span is searched again through the caller's connection, and only ids that
 * come back are linked. An id that no longer does — deleted, or the connection
 * changed — is skipped and counted, never linked blind.
 *
 * Returns a result instead of throwing on an Immich failure: the answer to the
 * journey is already recorded, and a library that is down must not turn a
 * successful accept into an error. The caller reports the outcome.
 */
export async function attachJourneyPhotosToVisit(
  userId: string,
  journeyId: string,
  visitId: string
): Promise<AttachOutcome> {
  const journey = await prisma.photoJourney.findFirst({
    where: { id: journeyId, userId },
    select: {
      previewAssetIds: true,
      startDate: true,
      endDate: true,
      kind: true,
      lat: true,
      lon: true,
    },
  });
  const visit = await prisma.placeVisit.findFirst({
    where: { id: visitId, userId },
    select: { id: true, placeId: true },
  });
  const isStop = journey?.kind === "visit";
  if (!journey || !visit || (!isStop && journey.previewAssetIds.length === 0)) {
    return { kind: "linked", linked: 0, skipped: 0 };
  }

  const immich = await attachFromImmich(userId, journeyId, journey, visitId, isStop);
  // A photo stop is every library's photographs of that spot, PhotoPrism's too (#414).
  const outcome = isStop
    ? combine(immich, await attachFromPhotoprism(userId, journeyId, journey, visitId))
    : immich;
  if (outcome.kind === "linked" && outcome.linked > 0) {
    await coverPlaceIfBare(visit.placeId, visitId);
  }
  return outcome;
}

type JourneySpan = {
  previewAssetIds: string[];
  startDate: Date;
  endDate: Date;
  lat: number;
  lon: number;
};

const spanOf = (journey: JourneySpan): { takenAfter: Date; takenBefore: Date } => ({
  takenAfter: new Date(journey.startDate.getTime() - JOURNEY_SEARCH_PAD_MS),
  takenBefore: new Date(journey.endDate.getTime() + JOURNEY_SEARCH_PAD_MS),
});

async function attachFromImmich(
  userId: string,
  journeyId: string,
  journey: JourneySpan,
  visitId: string,
  isStop: boolean
): Promise<AttachOutcome> {
  const connection = await getImmichConnection(userId);
  if (connection === null) return { kind: "notConfigured" };
  const client = createImmichClient(connection);

  let library: ImmichAsset[];
  try {
    library = await getCachedAlbumAssets(userId, `journey:${journeyId}`, async () => {
      const page = await client.searchAssetsByDate(spanOf(journey));
      return page.assets;
    });
  } catch (error) {
    if (!(error instanceof ImmichError)) throw error;
    logger.warn({
      message: "journey_photo_attach_failed",
      context: { journeyId, kind: error.kind },
    });
    return { kind: "failed", reason: error.kind };
  }

  const byId = new Map(library.map((asset) => [asset.id, asset]));
  const proven = journey.previewAssetIds
    .map((id) => byId.get(id))
    .filter((asset): asset is ImmichAsset => asset !== undefined);
  // A photo stop keeps only three preview ids, so linking those left a "58 photos" stop
  // with three (#414). Its cluster is every located photo of the span within the stop's
  // radius — the scan's own rule — and accepting the stop is the user's explicit choice
  // for all of them, so the automatic 5–10 cap does not apply here.
  const cluster = isStop
    ? library.filter((asset) => inStopRadius(asset, journey) && !proven.includes(asset))
    : [];
  const linked = await linkImmichAssetsToVisit(visitId, [...proven, ...sortByTime(cluster)]);
  return { kind: "linked", linked, skipped: journey.previewAssetIds.length - proven.length };
}

/** The stop's photographs in PhotoPrism: same span, same radius, linked as `photoprism` rows. */
async function attachFromPhotoprism(
  userId: string,
  journeyId: string,
  journey: JourneySpan,
  visitId: string
): Promise<AttachOutcome> {
  const connection = await getPhotoSourceConnection("photoprism", userId);
  if (connection === null) return { kind: "notConfigured" };
  let assets: PhotoSourceAsset[];
  try {
    const page = await createPhotoSource("photoprism", connection).searchAssetsByTime(
      spanOf(journey)
    );
    assets = page.assets;
  } catch (error) {
    if (!(error instanceof ImmichError)) throw error;
    logger.warn({
      message: "journey_photo_attach_failed",
      context: { journeyId, provider: "photoprism", kind: error.kind },
    });
    return { kind: "failed", reason: error.kind };
  }
  const cluster = sortByTime(assets.filter((asset) => inStopRadius(asset, journey)));
  const linked = await linkAssetsToVisit(
    visitId,
    cluster.map((asset) => ({ provider: "photoprism" as const, asset })),
    "manual"
  );
  return { kind: "linked", linked, skipped: 0 };
}

/**
 * One outcome for two libraries. Photos linked from either make it `linked`;
 * a library that failed meanwhile is named in `failedSources`, never dropped.
 */
function combine(immich: AttachOutcome, photoprism: AttachOutcome): AttachOutcome {
  const linked = (o: AttachOutcome): number => (o.kind === "linked" ? o.linked : 0);
  const failed = [
    ...(immich.kind === "failed" ? [{ provider: "immich" as const, reason: immich.reason }] : []),
    ...(photoprism.kind === "failed"
      ? [{ provider: "photoprism" as const, reason: photoprism.reason }]
      : []),
  ];
  if (immich.kind !== "linked" && photoprism.kind !== "linked") {
    return failed[0] ? { kind: "failed", reason: failed[0].reason } : { kind: "notConfigured" };
  }
  return {
    kind: "linked",
    linked: linked(immich) + linked(photoprism),
    skipped: immich.kind === "linked" ? immich.skipped : 0,
    ...(failed.length > 0 ? { failedSources: failed } : {}),
  };
}

function inStopRadius(asset: PhotoSourceAsset, stop: { lat: number; lon: number }): boolean {
  if (asset.lat === null || asset.lon === null) return false;
  return haversineKm(stop, { lat: asset.lat, lon: asset.lon }) * 1000 <= VISIT_STOP_OPTIONS.radiusM;
}

function sortByTime<T extends PhotoSourceAsset>(assets: T[]): T[] {
  return [...assets].sort((a, b) => (a.fileCreatedAt ?? "").localeCompare(b.fileCreatedAt ?? ""));
}

/** A place with no cover takes the first photo of the visit just linked (#414). */
async function coverPlaceIfBare(placeId: string, visitId: string): Promise<void> {
  const place = await prisma.place.findUnique({
    where: { id: placeId },
    select: { coverPhotoId: true },
  });
  if (!place || place.coverPhotoId !== null) return;
  const first = await prisma.placeVisitPhoto.findFirst({
    where: { placeVisitId: visitId },
    orderBy: { sortIdx: "asc" },
    select: { id: true },
  });
  if (first) {
    await prisma.place.updateMany({
      where: { id: placeId, coverPhotoId: null },
      data: { coverPhotoId: first.id },
    });
  }
}
