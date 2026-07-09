/**
 * Import ("copy") mode: download an Immich album's originals onto the data
 * volume and register them as ordinary `TripPhoto` rows.
 *
 * Progress is tracked with a DB status row, mirroring `airportSeedingService`
 * — this repo has no job queue, only cron schedulers, and the UI polls.
 *
 * Idempotency lives in the `(trip_id, immich_asset_id)` unique index: a
 * re-sync lists the album again and downloads only what is missing. One bad
 * asset fails that asset, not the run.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { prisma } from "../../db";
import { deleteTripPhotoFile, getTripPhotoDir } from "../../middleware/upload";
import logger from "../../utils/logger";
import { createImmichClient } from "./immichClient";
import { getImmichConnection } from "./immichResolver";
import { invalidateAlbumAssets } from "./immichAssetCache";
import { ImmichAsset } from "./types";

/** Mirrors the multer `tripPhotoFilter` allow-list — same bytes, same rules. */
export const IMPORT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/** Keep the event loop responsive on a 5000-photo album. */
const CHUNK_SIZE = 10;

export interface ImportJobDto {
  status: "pending" | "running" | "completed" | "failed";
  totalAssets: number;
  processedAssets: number;
  failedAssets: number;
  error: string | null;
}

const isImportable = (asset: ImmichAsset): boolean =>
  asset.type === "IMAGE" &&
  (IMPORT_ALLOWED_MIME_TYPES as readonly string[]).includes(asset.mimeType);

/** Same shape multer produces, so both upload paths look alike on disk. */
function buildFilename(originalName: string): string {
  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const ext = path.extname(originalName).toLowerCase();
  const basename = path.basename(originalName, ext);
  const sanitized = basename.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 40);
  return `${uniqueSuffix}-${sanitized}${ext}`;
}

export function deleteImportedPhotoFiles(filenames: string[]): void {
  for (const filename of filenames) {
    deleteTripPhotoFile(filename);
  }
}

export async function getImportJob(linkId: string): Promise<ImportJobDto | null> {
  const job = await prisma.immichImportJob.findUnique({ where: { albumLinkId: linkId } });
  if (!job) return null;
  return {
    status: job.status as ImportJobDto["status"],
    totalAssets: job.totalAssets,
    processedAssets: job.processedAssets,
    failedAssets: job.failedAssets,
    error: job.error,
  };
}

export async function estimateAlbumImport(
  userId: string,
  albumId: string,
): Promise<{ assetCount: number; totalBytes: number }> {
  const conn = await getImmichConnection(userId);
  if (!conn) return { assetCount: 0, totalBytes: 0 };

  const assets = (await createImmichClient(conn).listAlbumAssets(albumId)).filter(isImportable);

  return {
    assetCount: assets.length,
    totalBytes: assets.reduce((sum, a) => sum + (a.sizeBytes ?? 0), 0),
  };
}

/** Download one asset. Returns false on any per-asset failure. */
async function importAsset(
  client: ReturnType<typeof createImmichClient>,
  tripId: string,
  linkId: string,
  asset: ImmichAsset,
): Promise<boolean> {
  const filename = buildFilename(asset.originalFileName);
  const filePath = path.join(getTripPhotoDir(), filename);

  try {
    const upstream = await client.fetchAssetStream(asset.id, "original");
    await pipeline(upstream.stream, fs.createWriteStream(filePath));

    await prisma.tripPhoto.create({
      data: {
        tripId,
        filename,
        mimetype: asset.mimeType,
        sizeBytes: asset.sizeBytes ?? 0,
        takenAt: new Date(asset.fileCreatedAt),
        immichAssetId: asset.id,
        immichAlbumLinkId: linkId,
        lat: asset.lat,
        lon: asset.lon,
      },
    });
    return true;
  } catch (error) {
    logger.warn({
      message: "immich_import_asset_failed",
      error,
      context: { assetId: asset.id, linkId },
    });
    // Never leave bytes behind for a row that does not exist.
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (cleanupError) {
      logger.warn({ message: "immich_import_cleanup_failed", error: cleanupError });
    }
    return false;
  }
}

/**
 * Fire-and-forget. Callers must not await correctness from this — it reports
 * through the job row. It never rejects, so a failed import cannot take down
 * the request that triggered it.
 */
export async function startAlbumImport(userId: string, linkId: string): Promise<void> {
  try {
    const existing = await prisma.immichImportJob.findUnique({ where: { albumLinkId: linkId } });
    if (existing?.status === "running") {
      logger.info({ message: "immich_import_already_running", context: { linkId } });
      return;
    }

    const link = await prisma.tripImmichAlbum.findUnique({ where: { id: linkId } });
    if (!link) return;

    const conn = await getImmichConnection(userId);
    if (!conn) {
      logger.warn({ message: "immich_import_no_connection", context: { linkId } });
      return;
    }

    const runningJob = {
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      error: null,
      processedAssets: 0,
      failedAssets: 0,
    };
    await prisma.immichImportJob.upsert({
      where: { albumLinkId: linkId },
      update: runningJob,
      create: { albumLinkId: linkId, ...runningJob },
    });

    const client = createImmichClient(conn);
    let processed = 0;
    let failed = 0;

    try {
      const all = await client.listAlbumAssets(link.immichAlbumId);
      const importable = all.filter(isImportable);

      const alreadyImported = await prisma.tripPhoto.findMany({
        where: { tripId: link.tripId, immichAssetId: { not: null } },
        select: { immichAssetId: true },
      });
      const seen = new Set(alreadyImported.map((p) => p.immichAssetId));
      const todo = importable.filter((a) => !seen.has(a.id));

      await prisma.immichImportJob.update({
        where: { albumLinkId: linkId },
        data: { totalAssets: todo.length },
      });

      for (let i = 0; i < todo.length; i += CHUNK_SIZE) {
        const chunk = todo.slice(i, i + CHUNK_SIZE);
        const results = await Promise.all(
          chunk.map((asset) => importAsset(client, link.tripId, linkId, asset)),
        );
        processed += results.filter(Boolean).length;
        failed += results.filter((ok) => !ok).length;

        await prisma.immichImportJob.update({
          where: { albumLinkId: linkId },
          data: { processedAssets: processed, failedAssets: failed },
        });
      }

      await prisma.immichImportJob.update({
        where: { albumLinkId: linkId },
        data: {
          status: "completed",
          completedAt: new Date(),
          processedAssets: processed,
          failedAssets: failed,
        },
      });
      await prisma.tripImmichAlbum.update({
        where: { id: linkId },
        data: { lastSyncedAt: new Date(), assetCount: importable.length },
      });
      invalidateAlbumAssets(userId, link.immichAlbumId);

      logger.info({
        message: "immich_import_completed",
        context: { linkId, processed, failed },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed";
      logger.error({ message: "immich_import_failed", error, context: { linkId } });
      await prisma.immichImportJob.update({
        where: { albumLinkId: linkId },
        data: { status: "failed", error: message, completedAt: new Date() },
      });
    }
  } catch (error) {
    // Last line of defence: a fire-and-forget job must never reject.
    logger.error({ message: "immich_import_crashed", error, context: { linkId } });
  }
}
