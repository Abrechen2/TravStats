/**
 * "Deckblatt vorschlagen": read the trip's photos from every route they reach
 * it by, score them (`score.ts`) and return the best three with their reasons.
 *
 * Nothing is stored and nothing is set: the caller shows the three and the
 * user chooses. People and face data are read from the source on demand — only
 * the account's own "Das bin ich" id (a column on `UserSettings`) persists.
 *
 * A source that fails costs only its own photos. Each source answers with a
 * status of its own (`ok`, or the failure kind), so "no suggestion" is never
 * confused with "the library could not be read".
 */
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { createPhotoSource, listAllAlbumAssets } from "../photoSource";
import { getPhotoSourceConnection } from "../photoSource/connection";
import { PHOTO_SOURCE_KINDS } from "../photoSource/types";
import type { PhotoSourceAsset, PhotoSourceKind, PhotoSourceProvider } from "../photoSource/types";
import { getCachedAlbumAssets } from "../immich/immichAssetCache";
import { ImmichError, type ImmichErrorKind } from "../immich/types";
import { ENTRY_FK, type EntryKind } from "../photoLinking/entryKinds";
import { toKind } from "../photoLinking/entryPhotos";
import { rankCoverCandidates, type CoverAnchor, type CoverCandidate, type Reason } from "./score";
import { selfPersonId } from "./selfPerson";

/** Zones are not known per photo; a day of slack each side keeps a late-night frame in. */
const WINDOW_MARGIN_MS = 14 * 3_600_000;
const DAY_MS = 86_400_000;

export type SourceFailure = ImmichErrorKind | "notConfigured";

export interface SourceStatus {
  provider: PhotoSourceKind;
  /** Reading the trip's photos from this source. */
  photos: "ok" | SourceFailure;
  /** Recognising "me": `notSet` = no person chosen for this source yet. */
  people: "ok" | "notSet" | SourceFailure;
}

export type CoverApply =
  | { type: "photo"; photoId: string }
  | { type: "album"; linkId: string; assetId: string }
  | { type: "entry"; linkId: string };

export interface CoverSuggestion {
  key: string;
  thumbUrl: string;
  takenAt: string | null;
  score: number;
  reasons: Reason[];
  apply: CoverApply;
}

export interface CoverSuggestions {
  suggestions: CoverSuggestion[];
  /** Why there are none: no dates, nothing to look at, or nothing good enough. */
  abstained: "noTripDates" | "noCandidates" | "noneQualified" | null;
  sources: SourceStatus[];
}

interface Candidate extends CoverCandidate {
  apply: CoverApply;
  thumbUrl: string;
}

const FK_TO_KIND = Object.fromEntries(
  (Object.entries(ENTRY_FK) as Array<[EntryKind, string]>).map(([kind, fk]) => [fk, kind])
) as Record<string, EntryKind>;

function failureKind(error: unknown, provider: PhotoSourceKind): SourceFailure {
  if (error instanceof ImmichError) return error.kind;
  logger.error({ message: "cover_suggestions_source_failed", error, context: { provider } });
  return "protocol";
}

export function tripWindow(
  start: Date | null,
  end: Date | null
): { takenAfter: Date; takenBefore: Date } | null {
  if (!start || !end) return null;
  return {
    takenAfter: new Date(start.getTime() - WINDOW_MARGIN_MS),
    takenBefore: new Date(end.getTime() + DAY_MS + WINDOW_MARGIN_MS),
  };
}

const keyOf = (provider: PhotoSourceKind, assetId: string): string => `${provider}:${assetId}`;

function fromAsset(
  key: string,
  asset: PhotoSourceAsset | undefined,
  fallback: { takenAt: Date | null; mimeType: string; fileName: string },
  me: boolean
): CoverCandidate {
  return {
    key,
    takenAt: asset?.fileCreatedAt ? new Date(asset.fileCreatedAt) : fallback.takenAt,
    lat: asset?.lat ?? null,
    lon: asset?.lon ?? null,
    isVideo: asset?.type === "VIDEO",
    mimeType: asset?.mimeType ?? fallback.mimeType,
    fileName: asset?.originalFileName ?? fallback.fileName,
    me,
    favorite: asset?.favorite,
    width: asset?.width,
    height: asset?.height,
    cameraMake: asset?.cameraMake,
    quality: asset?.quality,
  };
}

interface SourceRead {
  status: SourceStatus;
  /** Every asset this source returned for the window or the trip's albums. */
  assets: Map<string, PhotoSourceAsset>;
  /** Asset ids of the chosen person, within the window. */
  mine: Set<string>;
  /** Link-mode album assets, with the link that serves them. */
  albumAssets: Array<{ linkId: string; asset: PhotoSourceAsset }>;
}

async function readSource(
  userId: string,
  provider: PhotoSourceKind,
  window: { takenAfter: Date; takenBefore: Date },
  links: Array<{ id: string; immichAlbumId: string; mode: string }>
): Promise<SourceRead> {
  const read: SourceRead = {
    status: { provider, photos: "ok", people: "notSet" },
    assets: new Map(),
    mine: new Set(),
    albumAssets: [],
  };
  const conn = await getPhotoSourceConnection(provider, userId);
  if (!conn) {
    read.status = { provider, photos: "notConfigured", people: "notSet" };
    return read;
  }
  const source: PhotoSourceProvider = createPhotoSource(provider, conn);

  // Whole-window search: metadata (GPS, favourite, size) for every route in one go.
  const reads: Array<Promise<void>> = [
    (async () => {
      const found = await source.searchAssetsByTime(window);
      for (const a of found.assets) read.assets.set(a.id, a);
    })(),
    ...links.map(async (link) => {
      const assets = await getCachedAlbumAssets(
        userId,
        link.immichAlbumId,
        () => listAllAlbumAssets(source, link.immichAlbumId),
        provider
      );
      for (const a of assets) {
        read.assets.set(a.id, a);
        if (link.mode !== "import") read.albumAssets.push({ linkId: link.id, asset: a });
      }
    }),
  ];
  const settled = await Promise.allSettled(reads);
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
  // One failed read of the library is reported, but what the other reads found still counts.
  if (failed) read.status.photos = failureKind(failed.reason, provider);

  const personId = await selfPersonId(userId, provider);
  if (personId) {
    try {
      const found = await source.searchAssetsByTime(window, { personId });
      for (const a of found.assets) read.mine.add(a.id);
      read.status.people = "ok";
    } catch (error) {
      read.status.people = failureKind(error, provider);
    }
  }
  return read;
}

export async function suggestCover(userId: string, tripId: string): Promise<CoverSuggestions> {
  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: tripId, userId },
    select: { startDate: true, endDate: true },
  });
  const window = tripWindow(trip.startDate, trip.endDate);
  if (!window) return { suggestions: [], abstained: "noTripDates", sources: [] };

  const [photos, links, entryLinks, stays, visits] = await Promise.all([
    prisma.tripPhoto.findMany({
      where: { tripId },
      select: {
        id: true,
        filename: true,
        mimetype: true,
        takenAt: true,
        lat: true,
        lon: true,
        provider: true,
        immichAssetId: true,
      },
    }),
    prisma.tripImmichAlbum.findMany({
      where: { tripId },
      select: { id: true, immichAlbumId: true, provider: true, mode: true },
    }),
    prisma.entryPhotoLink.findMany({
      where: {
        userId,
        refused: false,
        OR: [
          { flight: { tripId } },
          { lodgingStay: { tripId } },
          { railJourney: { tripId } },
          { busJourney: { tripId } },
          { ferryJourney: { tripId } },
          { rental: { tripId } },
        ],
      },
      select: {
        id: true,
        provider: true,
        assetId: true,
        mimetype: true,
        takenAt: true,
        flightId: true,
        lodgingStayId: true,
        railJourneyId: true,
        busJourneyId: true,
        ferryJourneyId: true,
        rentalId: true,
      },
    }),
    prisma.lodgingStay.findMany({
      where: { tripId, lodging: { userId } },
      select: { lodging: { select: { lat: true, lon: true } } },
    }),
    prisma.placeVisit.findMany({
      where: { tripId, place: { userId } },
      select: { place: { select: { lat: true, lon: true } } },
    }),
  ]);

  const anchors: CoverAnchor[] = [
    ...stays.map((s) => s.lodging),
    ...visits.map((v) => v.place),
  ].flatMap((p) => (p.lat !== null && p.lon !== null ? [{ lat: p.lat, lon: p.lon }] : []));

  // Which sources matter: one with a library connection, or one the trip already points at.
  const referenced = new Set<PhotoSourceKind>([
    ...links.map((l) => toKind(l.provider)),
    ...photos.flatMap((p) => (p.immichAssetId ? [toKind(p.provider)] : [])),
    ...entryLinks.map((l) => toKind(l.provider)),
  ]);
  const reads = (
    await Promise.all(
      PHOTO_SOURCE_KINDS.map(async (provider) => {
        const read = await readSource(
          userId,
          provider,
          window,
          links.filter((l) => toKind(l.provider) === provider)
        );
        const used = read.status.photos !== "notConfigured" || referenced.has(provider);
        return used ? [read] : [];
      })
    )
  ).flat();
  const byProvider = new Map(reads.map((r) => [r.status.provider, r]));

  const candidates = new Map<string, Candidate>();
  const add = (c: Candidate): void => {
    if (!candidates.has(c.key)) candidates.set(c.key, c);
  };
  const isMine = (provider: PhotoSourceKind, assetId: string): boolean =>
    byProvider.get(provider)?.mine.has(assetId) ?? false;

  // Precedence: a copy in the trip's own gallery, then a live album, then an entry's link.
  for (const p of photos) {
    const provider = toKind(p.provider);
    const imported = p.immichAssetId !== null;
    const key = imported ? keyOf(provider, p.immichAssetId!) : `photo:${p.id}`;
    const asset = imported ? byProvider.get(provider)?.assets.get(p.immichAssetId!) : undefined;
    const base = fromAsset(
      key,
      asset,
      { takenAt: p.takenAt, mimeType: p.mimetype, fileName: p.filename },
      imported && isMine(provider, p.immichAssetId!)
    );
    add({
      ...base,
      // An upload carries its own EXIF position; a source's copy is preferred where it has one.
      lat: base.lat ?? p.lat,
      lon: base.lon ?? p.lon,
      apply: { type: "photo", photoId: p.id },
      thumbUrl: `/api/v1/trips/${tripId}/photos/${p.id}/file`,
    });
  }
  for (const read of reads) {
    for (const { linkId, asset } of read.albumAssets) {
      const key = keyOf(read.status.provider, asset.id);
      add({
        ...fromAsset(
          key,
          asset,
          { takenAt: null, mimeType: "", fileName: "" },
          read.mine.has(asset.id)
        ),
        apply: { type: "album", linkId, assetId: asset.id },
        thumbUrl: `/api/v1/trips/${tripId}/immich/albums/${linkId}/assets/${asset.id}/file?size=thumbnail`,
      });
    }
  }
  for (const l of entryLinks) {
    const provider = toKind(l.provider);
    const fk = (Object.keys(FK_TO_KIND) as string[]).find(
      (k) => (l as unknown as Record<string, unknown>)[k] != null
    );
    if (!fk) continue;
    const entryId = (l as unknown as Record<string, string>)[fk];
    const asset = byProvider.get(provider)?.assets.get(l.assetId);
    add({
      ...fromAsset(
        keyOf(provider, l.assetId),
        asset,
        { takenAt: l.takenAt, mimeType: l.mimetype, fileName: "" },
        isMine(provider, l.assetId)
      ),
      apply: { type: "entry", linkId: l.id },
      thumbUrl: `/api/v1/entry-photos/${FK_TO_KIND[fk]}/${entryId}/photos/${l.id}/file?size=thumbnail`,
    });
  }

  const inWindow = [...candidates.values()].filter(
    (c) => c.takenAt !== null && c.takenAt >= window.takenAfter && c.takenAt <= window.takenBefore
  );
  const ranked = rankCoverCandidates(inWindow, anchors);
  const sources = reads.map((r) => r.status);
  if (ranked.length === 0) {
    return {
      suggestions: [],
      abstained: inWindow.length === 0 ? "noCandidates" : "noneQualified",
      sources,
    };
  }
  return {
    suggestions: ranked.map((r) => ({
      key: r.candidate.key,
      thumbUrl: r.candidate.thumbUrl,
      takenAt: r.candidate.takenAt?.toISOString() ?? null,
      score: r.score,
      reasons: r.reasons,
      apply: r.candidate.apply,
    })),
    abstained: null,
    sources,
  };
}
