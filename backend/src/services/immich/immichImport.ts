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
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { FILE_LIMITS } from "../../config/constants";
import { deleteTripPhotoFile, getTripPhotoDir } from "../../middleware/upload";
import logger from "../../utils/logger";
import { createImmichClient } from "./immichClient";
import { getImmichConnection } from "./immichResolver";
import { invalidateAlbumAssets } from "./immichAssetCache";
import { ImmichAsset } from "./types";

/** Marks a stream aborted for exceeding the per-asset byte cap (M2), distinct
 *  from a genuine upstream/write failure. */
const ASSET_TOO_LARGE_CODE = "IMMICH_ASSET_TOO_LARGE";

interface AssetTooLargeError extends Error {
  code: typeof ASSET_TOO_LARGE_CODE;
  bytes: number;
}

function isAssetTooLarge(error: unknown): error is AssetTooLargeError {
  return error instanceof Error && (error as { code?: unknown }).code === ASSET_TOO_LARGE_CODE;
}

/** A concurrent import of a sibling album sharing this asset already created
 *  the `(tripId, immichAssetId)` row — the asset is present, not failed (M5). */
function isDuplicateAsset(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * A passthrough that aborts once cumulative bytes exceed `maxBytes`. Guards the
 * import when Immich reports no size upfront: `pipeline()` destroys the source
 * and the write target on abort, and the caller removes the partial file.
 */
export function createByteCapStream(maxBytes: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb): void {
      total += chunk.length;
      if (total > maxBytes) {
        const error: AssetTooLargeError = Object.assign(
          new Error(`Asset exceeds ${maxBytes} bytes`),
          { code: ASSET_TOO_LARGE_CODE, bytes: total } as const,
        );
        cb(error);
        return;
      }
      cb(null, chunk);
    },
  });
}

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

/**
 * Crash-recovery escape hatch, NOT a time limit on legitimate long imports.
 * A live run keeps refreshing the job row's `updatedAt` (every
 * `immichImportJob.update` call during the chunk loop bumps Prisma's
 * `@updatedAt` field), so a genuinely still-running import never looks
 * stale. Only a `running` row whose last progress write predates this
 * window is presumed to belong to a process that died mid-import (e.g. a
 * container restart) and is safe to reclaim.
 */
export const IMPORT_STALE_AFTER_MS = 30 * 60_000;

/**
 * In-flight `linkId`s for this process. A single Node process serves every
 * import here (no job queue), so a `Set` closes the TOCTOU window between
 * reading the job row and writing its `running` status: the check-and-add
 * below happens with no `await` in between, so two near-simultaneous calls
 * for the same `linkId` cannot both slip past it.
 */
const inFlightImports = new Set<string>();

/** Test seam. Never called from production code. */
export function clearImportGuards(): void {
  inFlightImports.clear();
}

/**
 * Whether an import run currently holds the in-flight guard for this link.
 *
 * The `/resync` route consults this BEFORE it resets a stale terminal job row
 * to `pending`: a link that is genuinely importing already owns a `running`
 * row that this process is advancing, so resetting it would both clobber live
 * progress and — because `startAlbumImport` refuses an in-flight link — strand
 * the row on `pending` forever. When this returns `true`, leave the row alone.
 */
export function isImportInFlight(linkId: string): boolean {
  return inFlightImports.has(linkId);
}

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

/**
 * Quotes the importable size of the WHOLE album, not a "how much is left to
 * sync" delta — it has no notion of already-imported assets. The signature
 * is deliberately `albumId`-only (no `tripId`), which makes such a delta
 * structurally impossible here. Do not repurpose this for a
 * remaining-to-sync UI without adding that parameter; it will quote the
 * wrong (too-large) number.
 */
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

/**
 * Download one asset. Returns `false` on a per-asset failure (network, oversize,
 * write error), `true` when the asset is now present in the trip — including the
 * concurrent-sibling P2002 case, where it is present via another link and must
 * not inflate `failedAssets`.
 */
async function importAsset(
  client: ReturnType<typeof createImmichClient>,
  tripId: string,
  linkId: string,
  asset: ImmichAsset,
): Promise<boolean> {
  // Cheap pre-flight: if Immich already reports the asset as oversized, skip it
  // before spending bandwidth or disk. Counts as a per-asset failure (M2).
  if (asset.sizeBytes !== null && asset.sizeBytes > FILE_LIMITS.IMMICH_MAX_ASSET_BYTES) {
    logger.warn({
      message: "immich_import_asset_too_large",
      context: {
        assetId: asset.id,
        linkId,
        sizeBytes: asset.sizeBytes,
        maxBytes: FILE_LIMITS.IMMICH_MAX_ASSET_BYTES,
      },
    });
    return false;
  }

  const filename = buildFilename(asset.originalFileName);
  const filePath = path.join(getTripPhotoDir(), filename);

  const cleanup = (): void => {
    // Never leave bytes behind for a row that does not exist.
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (cleanupError) {
      logger.warn({ message: "immich_import_cleanup_failed", error: cleanupError });
    }
  };

  try {
    const upstream = await client.fetchAssetStream(asset.id, "original");
    // The byte cap also guards the case where Immich reported no size (no EXIF
    // row yet): the stream is aborted the moment it crosses the ceiling and the
    // partial file is cleaned up below (M2).
    await pipeline(
      upstream.stream,
      createByteCapStream(FILE_LIMITS.IMMICH_MAX_ASSET_BYTES),
      fs.createWriteStream(filePath),
    );

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
    if (isAssetTooLarge(error)) {
      logger.warn({
        message: "immich_import_asset_too_large",
        context: {
          assetId: asset.id,
          linkId,
          sizeBytes: error.bytes,
          maxBytes: FILE_LIMITS.IMMICH_MAX_ASSET_BYTES,
        },
      });
      cleanup();
      return false;
    }
    if (isDuplicateAsset(error)) {
      // Present in the trip via a sibling album that won the unique index — not
      // a failure. Drop the duplicate bytes we just downloaded (M5).
      logger.info({
        message: "immich_import_asset_already_present",
        context: { assetId: asset.id, linkId },
      });
      cleanup();
      return true;
    }
    logger.warn({
      message: "immich_import_asset_failed",
      error,
      context: { assetId: asset.id, linkId },
    });
    cleanup();
    return false;
  }
}

/**
 * Fire-and-forget. Callers must not await correctness from this — it reports
 * through the job row. It never rejects, so a failed import cannot take down
 * the request that triggered it.
 */
export async function startAlbumImport(userId: string, linkId: string): Promise<void> {
  // Synchronous check-and-add — no `await` between them — so two calls that
  // arrive close together for the same `linkId` cannot both pass this gate.
  if (inFlightImports.has(linkId)) {
    logger.info({ message: "immich_import_already_running", context: { linkId } });
    return;
  }
  inFlightImports.add(linkId);

  try {
    try {
      const existing = await prisma.immichImportJob.findUnique({ where: { albumLinkId: linkId } });
      if (existing?.status === "running") {
        const staleForMs = Date.now() - existing.updatedAt.getTime();
        if (staleForMs < IMPORT_STALE_AFTER_MS) {
          logger.info({ message: "immich_import_already_running", context: { linkId } });
          return;
        }
        logger.warn({
          message: "immich_import_reclaimed_stale_job",
          context: { linkId, staleForMs, lastProgressAt: existing.updatedAt.toISOString() },
        });
      }

      const link = await prisma.tripImmichAlbum.findUnique({ where: { id: linkId } });
      if (!link) return;

      const conn = await getImmichConnection(userId);
      if (!conn) {
        logger.warn({ message: "immich_import_no_connection", context: { linkId } });
        // Close the residual race behind the resync route's own pre-check: if a
        // previous step reset the row to `pending` (or a crash left `running`)
        // and the connection then vanished, mark it terminally `failed` so the
        // frontend stops polling instead of hanging forever (M1). A no-op when
        // no such row exists (the initial-link import path has none yet).
        await prisma.immichImportJob.updateMany({
          where: { albumLinkId: linkId, status: { in: ["pending", "running"] } },
          data: { status: "failed", error: "notConfigured", completedAt: new Date() },
        });
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
  } finally {
    // Always release, even on an early return or an unforeseen throw — a
    // crashed or failed run must not permanently block the next re-sync.
    inFlightImports.delete(linkId);
  }
}
