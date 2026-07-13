/**
 * Trip <-> Immich album linking.
 *
 * Lives outside `routes/trips.ts` because that file is already at the 800-line
 * hard maximum. Ownership is enforced by the same `resolveTrip` guard every
 * other trip sub-route uses, plus a link-belongs-to-trip check.
 *
 * Immich failures never surface as a 500: they become a 502 with a
 * machine-readable `error` kind so the gallery can render a degraded panel
 * instead of crashing.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { resolveTrip } from "../trips";
import { linkAlbumsSchema, unlinkQuerySchema } from "../../schemas/immich";
import { createImmichClient } from "../../services/immich/immichClient";
import { getImmichConnection, getImmichDefaultMode } from "../../services/immich/immichResolver";
import { getCachedAlbumAssets, invalidateAlbumAssets } from "../../services/immich/immichAssetCache";
import {
  deleteImportedPhotoFiles,
  estimateAlbumImport,
  getImportJob,
  isImportInFlight,
  startAlbumImport,
} from "../../services/immich/immichImport";
import { ImmichAsset, ImmichConnection, ImmichError, ImmichMode } from "../../services/immich/types";
import { immichImportLimiter, immichProxyLimiter } from "../../middleware/rateLimit";
import logger from "../../utils/logger";

const router = Router();

export interface LinkedAlbumDto {
  id: string;
  immichAlbumId: string;
  albumName: string;
  assetCount: number;
  thumbnailAssetId: string | null;
  mode: ImmichMode;
  sortIdx: number;
  lastSyncedAt: string | null;
}

export interface GalleryAssetDto {
  id: string;
  url: string;
  previewUrl: string;
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
}

/** Turn any Immich failure into a 502 + kind. Anything else bubbles as-is. */
function sendImmichFailure(res: Response, error: unknown, next: NextFunction): void {
  if (error instanceof ImmichError) {
    logger.warn({ message: "immich_upstream_failure", context: { kind: error.kind } });
    res.status(502).json({ error: error.kind, message: error.message });
    return;
  }
  next(error);
}

/** Resolve the connection or answer 409 — "you have not configured Immich". */
async function requireConnection(userId: string, res: Response): Promise<ImmichConnection | null> {
  const conn = await getImmichConnection(userId);
  if (!conn) {
    res.status(409).json({ error: "notConfigured", message: "No Immich connection configured" });
    return null;
  }
  return conn;
}

/** The link must exist AND belong to the trip the caller already proved they own. */
async function resolveLink(
  tripId: string,
  linkId: string,
): Promise<{ id: string; immichAlbumId: string; mode: string }> {
  const link = await prisma.tripImmichAlbum.findFirst({
    where: { id: linkId, tripId },
    select: { id: true, immichAlbumId: true, mode: true },
  });
  // The message IS the machine-readable failure kind: `errorHandler`
  // serialises it as `{ error: "notFound" }`, which the frontend's
  // `immichFailureKind()` classifies (a domain 404, distinct from an upstream
  // Immich failure). See the error-taxonomy note in `sendImmichFailure`.
  if (!link) throw new AppError("notFound", 404);
  return link;
}

const toLinkDto = (row: {
  id: string;
  immichAlbumId: string;
  albumName: string;
  assetCount: number;
  thumbnailAssetId: string | null;
  mode: string;
  sortIdx: number;
  lastSyncedAt: Date | null;
}): LinkedAlbumDto => ({
  id: row.id,
  immichAlbumId: row.immichAlbumId,
  albumName: row.albumName,
  assetCount: row.assetCount,
  thumbnailAssetId: row.thumbnailAssetId,
  mode: row.mode === "import" ? "import" : "link",
  sortIdx: row.sortIdx,
  lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
});

const proxyUrl = (tripId: string, linkId: string, assetId: string, size: string): string =>
  `/api/v1/trips/${tripId}/immich/albums/${linkId}/assets/${assetId}/file?size=${size}`;

/* ─── Album picker ─── */

router.get(
  "/trips/:id/immich/albums",
  authenticate,
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);

      const conn = await requireConnection(userId, res);
      if (!conn) return;

      const albums = await createImmichClient(conn).listAlbums();
      const links = await prisma.tripImmichAlbum.findMany({
        where: { tripId: req.params.id },
        select: { id: true, immichAlbumId: true },
      });
      const linkByAlbum = new Map(links.map((l) => [l.immichAlbumId, l.id]));

      res.json({
        albums: albums.map((album) => ({
          ...album,
          linked: linkByAlbum.has(album.id),
          linkId: linkByAlbum.get(album.id) ?? null,
        })),
        defaultMode: await getImmichDefaultMode(userId),
      });
    } catch (error) {
      sendImmichFailure(res, error, next);
    }
  },
);

/* ─── Link ─── */

router.post(
  "/trips/:id/immich/albums",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const { albums: requested } = linkAlbumsSchema.parse(req.body);
      const conn = await requireConnection(userId, res);
      if (!conn) return;

      // Only albums the user's own Immich actually exposes may be linked —
      // this is the ownership boundary for every later proxy request.
      const available = await createImmichClient(conn).listAlbums();
      const byId = new Map(available.map((a) => [a.id, a]));
      const unknown = requested.filter((r) => !byId.has(r.immichAlbumId));
      if (unknown.length > 0) {
        throw new AppError(`Unknown Immich album: ${unknown[0].immichAlbumId}`, 400);
      }

      const existing = await prisma.tripImmichAlbum.findMany({
        where: { tripId },
        select: { sortIdx: true },
        orderBy: { sortIdx: "desc" },
        take: 1,
      });
      let nextIdx = (existing[0]?.sortIdx ?? -1) + 1;

      await prisma.tripImmichAlbum.createMany({
        data: requested.map((r) => {
          const album = byId.get(r.immichAlbumId)!;
          return {
            tripId,
            immichAlbumId: album.id,
            albumName: album.albumName,
            assetCount: album.assetCount,
            thumbnailAssetId: album.thumbnailAssetId,
            mode: r.mode,
            sortIdx: nextIdx++,
          };
        }),
        skipDuplicates: true,
      });

      const links = await prisma.tripImmichAlbum.findMany({
        where: { tripId },
        orderBy: { sortIdx: "asc" },
      });

      // Import mode downloads in the background; the UI polls the job.
      for (const link of links) {
        const wasRequested = requested.some((r) => r.immichAlbumId === link.immichAlbumId);
        if (wasRequested && link.mode === "import") {
          void startAlbumImport(userId, link.id);
        }
      }

      logger.info({
        message: "immich_albums_linked",
        context: { userId, tripId, count: requested.length },
      });

      res.status(201).json({ links: links.map(toLinkDto) });
    } catch (error) {
      sendImmichFailure(res, error, next);
    }
  },
);

/* ─── Unlink ─── */

router.delete(
  "/trips/:id/immich/albums/:linkId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const link = await resolveLink(tripId, req.params.linkId);
      const { deleteCopies } = unlinkQuerySchema.parse(req.query);

      if (link.mode === "import") {
        if (deleteCopies) {
          // Remove the bytes first: the cascade would drop the rows and orphan
          // the files, and an orphaned file is invisible to every later cleanup.
          const photos = await prisma.tripPhoto.findMany({
            where: { immichAlbumLinkId: link.id },
            select: { filename: true },
          });
          deleteImportedPhotoFiles(photos.map((p) => p.filename));
        } else {
          // Keep the copies as ordinary uploads by severing the FK, otherwise
          // `onDelete: Cascade` would delete them with the link row.
          await prisma.tripPhoto.updateMany({
            where: { immichAlbumLinkId: link.id },
            data: { immichAlbumLinkId: null },
          });
        }
      }

      // A live cover points at this link's proxy URL. Deleting the link would
      // leave the trip card rendering a 404 image, so clear it first.
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: { coverImageUrl: true },
      });
      if (trip?.coverImageUrl?.includes(`/immich/albums/${link.id}/`)) {
        await prisma.trip.update({ where: { id: tripId }, data: { coverImageUrl: null } });
      }

      await prisma.tripImmichAlbum.delete({ where: { id: link.id } });
      invalidateAlbumAssets(userId, link.immichAlbumId);

      logger.info({
        message: "immich_album_unlinked",
        context: { userId, tripId, linkId: link.id, deleteCopies },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

/* ─── Assets of one linked album ─── */

router.get(
  "/trips/:id/immich/albums/:linkId/assets",
  authenticate,
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const link = await resolveLink(tripId, req.params.linkId);

      if (link.mode === "import") {
        const photos = await prisma.tripPhoto.findMany({
          where: { immichAlbumLinkId: link.id },
          orderBy: { sortIdx: "asc" },
          select: { id: true, tripId: true, takenAt: true, lat: true, lon: true },
        });
        const fileUrl = (photoId: string): string =>
          `/api/v1/trips/${tripId}/photos/${photoId}/file`;

        res.json({
          assets: photos.map((p) => ({
            id: p.id,
            url: fileUrl(p.id),
            previewUrl: fileUrl(p.id),
            takenAt: p.takenAt?.toISOString() ?? null,
            lat: p.lat,
            lon: p.lon,
          })),
        });
        return;
      }

      const conn = await requireConnection(userId, res);
      if (!conn) return;

      const assets = await getCachedAlbumAssets(userId, link.immichAlbumId, () =>
        createImmichClient(conn).listAlbumAssets(link.immichAlbumId),
      );

      res.json({
        assets: assets
          .filter((a: ImmichAsset) => a.type === "IMAGE")
          .map((a: ImmichAsset) => ({
            id: a.id,
            url: proxyUrl(tripId, link.id, a.id, "thumbnail"),
            previewUrl: proxyUrl(tripId, link.id, a.id, "preview"),
            takenAt: a.fileCreatedAt,
            lat: a.lat,
            lon: a.lon,
          })),
      });
    } catch (error) {
      sendImmichFailure(res, error, next);
    }
  },
);

/* ─── Import job: estimate, kick, poll ─── */

router.get(
  "/trips/:id/immich/estimate",
  authenticate,
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);

      const albumId = typeof req.query.albumId === "string" ? req.query.albumId : "";
      if (!albumId) throw new AppError("albumId is required", 400);

      res.json(await estimateAlbumImport(userId, albumId));
    } catch (error) {
      sendImmichFailure(res, error, next);
    }
  },
);

router.post(
  "/trips/:id/immich/albums/:linkId/resync",
  authenticate,
  requireWriteScope,
  immichImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const link = await resolveLink(tripId, req.params.linkId);
      if (link.mode !== "import") {
        throw new AppError("Only imported albums can be re-synced", 400);
      }

      // Guard check BEFORE any reset. A link that is already importing owns a
      // `running` row this process is advancing; resetting it to `pending`
      // would clobber live progress AND — since startAlbumImport refuses an
      // in-flight link — strand the row on `pending` forever. Leave it alone
      // and report the run in progress.
      if (isImportInFlight(link.id)) {
        res.status(202).json({
          job: { status: "running", totalAssets: 0, processedAssets: 0, failedAssets: 0, error: null },
        });
        return;
      }

      // Resolve the connection BEFORE touching the row. If it is gone (the user
      // cleared/broke their Immich creds, then clicked Re-sync), resetting to
      // `pending` and firing startAlbumImport would strand the row: the
      // service's no-connection branch early-returns, and the stale-reclaim
      // only fires on `running`, so nothing ever advances a `pending` row —
      // the frontend polls forever (M1). Record a terminal failure instead.
      const conn = await getImmichConnection(userId);
      if (!conn) {
        await prisma.immichImportJob.upsert({
          where: { albumLinkId: link.id },
          update: { status: "failed", error: "notConfigured", completedAt: new Date(), startedAt: null },
          create: { albumLinkId: link.id, status: "failed", error: "notConfigured", completedAt: new Date() },
        });
        res.status(409).json({ error: "notConfigured", message: "No Immich connection configured" });
        return;
      }

      // Connection is good: clear the previous run's terminal row so the
      // frontend's immediate poll after the 202 sees a live (`pending`) run
      // instead of the stale `completed`, then fire the import.
      await prisma.immichImportJob.upsert({
        where: { albumLinkId: link.id },
        update: {
          status: "pending",
          processedAssets: 0,
          totalAssets: 0,
          failedAssets: 0,
          completedAt: null,
          error: null,
          startedAt: null,
        },
        create: {
          albumLinkId: link.id,
          status: "pending",
          processedAssets: 0,
          totalAssets: 0,
          failedAssets: 0,
          completedAt: null,
          error: null,
          startedAt: null,
        },
      });

      void startAlbumImport(userId, link.id);

      res.status(202).json({
        job: { status: "pending", totalAssets: 0, processedAssets: 0, failedAssets: 0, error: null },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/trips/:id/immich/albums/:linkId/import-job",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const link = await resolveLink(tripId, req.params.linkId);
      res.json({ job: await getImportJob(link.id) });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
