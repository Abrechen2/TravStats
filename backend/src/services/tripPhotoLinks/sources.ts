/**
 * The photo sources of a trip as one list — album links and period links
 * (spec 2026-11-26-trip-photo-links.md, contract `GET /trips/:id/photo-sources`) — and
 * the writes behind `POST`/`DELETE`. Only references are written: an album link in
 * link mode, a period row. Nothing is downloaded.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { queueAutoCover } from "../coverSuggestions/autoCover";
import { invalidateAlbumAssets } from "../immich/immichAssetCache";
import { createPhotoSource, type PhotoSourceKind } from "../photoSource";
import { getPhotoSourceConnection, toPhotoSourceKind } from "../photoSource/connection";
import { manualCoverData } from "../trip/tripCover";
import { periodDays, preferredPeriodProvider, tripPeriodContext } from "./periods";
import { PERIOD_KEY } from "./proposals";

export interface PhotoSourceDto {
  id: string;
  kind: "album" | "period";
  provider: PhotoSourceKind;
  /** One connection per provider today, so the connection is named by its provider. */
  connectionId: PhotoSourceKind;
  /** Album only: its name in the library. */
  name: string | null;
  /** Period: the days it covers (the trip's unless pinned); null for an album or an undated trip. */
  from: string | null;
  until: string | null;
  /** Period: the user set the days, so they no longer follow the trip. */
  pinned: boolean;
  /** Period: linked by the account's auto setting rather than a click. */
  auto: boolean;
  /** Album only, when the source told it; a period's size is only known once read. */
  count: number | null;
  /** Album only: `link` streams, `import` holds copies. */
  mode: "link" | "import" | null;
}

export type PhotoSourceRefusalKind =
  "notConfigured" | "notPreferred" | "noDates" | "importedAlbum" | "unknownAlbum";

/**
 * A refused write. The message IS the stable kind: `errorHandler` serialises it as
 * `{ error: "<kind>" }`, the same vocabulary the Immich routes speak, and the UI maps it
 * to DE/EN copy.
 */
export class PhotoSourceRefusal extends AppError {
  constructor(kind: PhotoSourceRefusalKind, status: number) {
    super(kind, status);
  }
}

export async function listTripPhotoSources(
  userId: string,
  tripId: string
): Promise<PhotoSourceDto[] | null> {
  const ctx = await tripPeriodContext(userId, tripId);
  if (ctx === null) return null;
  const [albums, periods] = await Promise.all([
    prisma.tripImmichAlbum.findMany({ where: { tripId }, orderBy: { sortIdx: "asc" } }),
    prisma.tripPhotoPeriod.findMany({ where: { tripId }, orderBy: { createdAt: "asc" } }),
  ]);
  return [
    ...albums.map((a): PhotoSourceDto => {
      const provider = toPhotoSourceKind(a.provider);
      return {
        id: a.id,
        kind: "album",
        provider,
        connectionId: provider,
        name: a.albumName,
        from: null,
        until: null,
        pinned: false,
        auto: false,
        // A PhotoPrism link-mode album stores 0 for "unknown" (see tripAlbums `toLinkDto`).
        count:
          a.assetCount === 0 && provider === "photoprism" && a.mode !== "import"
            ? null
            : a.assetCount,
        mode: a.mode === "import" ? "import" : "link",
      };
    }),
    ...periods.map((p): PhotoSourceDto => {
      const provider = toPhotoSourceKind(p.provider);
      const days = periodDays(p, ctx.tripDays);
      return {
        id: p.id,
        kind: "period",
        provider,
        connectionId: provider,
        name: null,
        from: days?.from ?? null,
        until: days?.until ?? null,
        pinned: p.fromDay !== null || p.untilDay !== null,
        auto: p.auto,
        count: null,
        mode: null,
      };
    }),
  ];
}

const dayColumn = (day: string): Date => new Date(`${day}T00:00:00Z`);

/**
 * Link the trip's days (or the pinned `from`/`until`) of the preferred source. Asking
 * for Immich while PhotoPrism is connected is refused: PhotoPrism holds the same
 * pictures and more, and a second period would show each of them twice.
 */
export async function addPeriodSource(
  userId: string,
  tripId: string,
  input: { connectionId?: PhotoSourceKind; from?: string; until?: string }
): Promise<string> {
  const ctx = await tripPeriodContext(userId, tripId);
  if (ctx === null) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND");
  const preferred = await preferredPeriodProvider(userId);
  if (preferred === null) throw new PhotoSourceRefusal("notConfigured", 409);
  const provider = input.connectionId ?? preferred;
  if (provider !== preferred) throw new PhotoSourceRefusal("notPreferred", 409);
  const pinned = input.from !== undefined || input.until !== undefined;
  if (!pinned && ctx.tripDays === null) throw new PhotoSourceRefusal("noDates", 400);
  const days = {
    fromDay: input.from ? dayColumn(input.from) : null,
    untilDay: input.until ? dayColumn(input.until) : null,
  };
  const row = await prisma.tripPhotoPeriod.upsert({
    where: { tripId_provider: { tripId, provider } },
    update: { ...days, auto: false },
    create: { tripId, provider, ...days },
    select: { id: true },
  });
  return row.id;
}

/** Link one album of the source in link mode (an import keeps its own album route). */
export async function addAlbumSource(
  userId: string,
  tripId: string,
  provider: PhotoSourceKind,
  albumId: string
): Promise<string> {
  const conn = await getPhotoSourceConnection(provider, userId);
  if (conn === null) throw new PhotoSourceRefusal("notConfigured", 409);
  // Only an album the user's own library exposes may be linked: the ownership
  // boundary of every later proxy request (same rule as the album route).
  const album = (await createPhotoSource(provider, conn).listAlbums()).find(
    (a) => a.id === albumId
  );
  if (!album) throw new PhotoSourceRefusal("unknownAlbum", 400);
  const last = await prisma.tripImmichAlbum.findFirst({
    where: { tripId },
    orderBy: { sortIdx: "desc" },
    select: { sortIdx: true },
  });
  const row = await prisma.tripImmichAlbum.upsert({
    where: { tripId_provider_immichAlbumId: { tripId, provider, immichAlbumId: album.id } },
    update: {},
    create: {
      tripId,
      provider,
      immichAlbumId: album.id,
      albumName: album.albumName,
      assetCount: album.assetCount ?? 0,
      thumbnailAssetId: album.thumbnailAssetId,
      mode: "link",
      sortIdx: (last?.sortIdx ?? -1) + 1,
    },
    select: { id: true },
  });
  queueAutoCover(userId);
  return row.id;
}

/** Clear a live cover that streams through the source about to go. */
async function clearCoverOf(tripId: string, urlPart: string): Promise<void> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { coverImageUrl: true },
  });
  if (trip?.coverImageUrl?.includes(urlPart)) {
    await prisma.trip.update({ where: { id: tripId }, data: manualCoverData(null) });
  }
}

/**
 * Remove a source of the trip. A removed period is remembered as dismissed, so neither
 * the auto setting nor the business offer brings it back. An imported album holds
 * copies and is removed through its own album route, which asks what to do with them.
 */
export async function removeTripPhotoSource(
  userId: string,
  tripId: string,
  sourceId: string
): Promise<void> {
  const period = await prisma.tripPhotoPeriod.findFirst({ where: { id: sourceId, tripId } });
  if (period) {
    await clearCoverOf(tripId, `/photo-sources/${period.id}/`);
    await prisma.$transaction([
      prisma.tripPhotoPeriod.delete({ where: { id: period.id } }),
      prisma.tripPhotoProposalDismissal.upsert({
        where: {
          tripId_provider_albumId: { tripId, provider: period.provider, albumId: PERIOD_KEY },
        },
        update: {},
        create: { tripId, provider: period.provider, albumId: PERIOD_KEY },
      }),
    ]);
    return;
  }
  const album = await prisma.tripImmichAlbum.findFirst({ where: { id: sourceId, tripId } });
  if (!album) throw new AppError("notFound", 404);
  if (album.mode === "import") throw new PhotoSourceRefusal("importedAlbum", 409);
  await clearCoverOf(tripId, `/immich/albums/${album.id}/`);
  await prisma.tripImmichAlbum.delete({ where: { id: album.id } });
  invalidateAlbumAssets(userId, album.immichAlbumId, album.provider);
  queueAutoCover(userId);
}

/** "Nicht dieses": `period`, or `<provider>:<albumId>` of a proposal. */
export async function dismissProposal(userId: string, tripId: string, key: string): Promise<void> {
  let provider: string;
  let albumId: string;
  if (key === PERIOD_KEY) {
    const preferred = await preferredPeriodProvider(userId);
    if (preferred === null) throw new PhotoSourceRefusal("notConfigured", 409);
    provider = preferred;
    albumId = PERIOD_KEY;
  } else {
    const at = key.indexOf(":");
    provider = toPhotoSourceKind(key.slice(0, at));
    albumId = key.slice(at + 1);
    if (
      at <= 0 ||
      albumId.length === 0 ||
      albumId === PERIOD_KEY ||
      provider !== key.slice(0, at)
    ) {
      throw new AppError("Invalid proposal key", 400);
    }
  }
  await prisma.tripPhotoProposalDismissal.upsert({
    where: { tripId_provider_albumId: { tripId, provider, albumId } },
    update: {},
    create: { tripId, provider, albumId },
  });
}
