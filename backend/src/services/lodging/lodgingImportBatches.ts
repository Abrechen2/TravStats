import { prisma } from "../../db";
import logger from "../../utils/logger";
import { AppError } from "../../middleware/errorHandler";
import {
  IMPORT_SOURCES,
  type LodgingImportBatchSummary,
  type LodgingImportSource,
} from "../../schemas/lodgingImport";
import {
  collectLodgingPhotoFilenames,
  removeLodgingPhotoFiles,
} from "./deleteLodgingPhotoFiles";

/** The column is a plain String; narrow it back to the union on the way out. */
function asSource(value: string): LodgingImportSource {
  return (IMPORT_SOURCES as readonly string[]).includes(value)
    ? (value as LodgingImportSource)
    : "csv";
}

export async function listLodgingImportBatches(
  userId: string,
): Promise<LodgingImportBatchSummary[]> {
  // This is the LODGING log. Filtering on the user alone listed the flight
  // and cruise imports here too, and the revert below then deleted a flight
  // batch it knew nothing about — leaving the flights orphaned of their undo
  // record (AUD-046).
  const batches = await prisma.importBatch.findMany({
    where: { userId, domain: "lodging" },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { lodgings: true, stays: true } } },
  });

  return batches.map((b) => ({
    id: b.id,
    source: asSource(b.source),
    fileName: b.fileName,
    createdAt: b.createdAt.toISOString(),
    lodgingCount: b._count.lodgings,
    stayCount: b._count.stays,
  }));
}

export interface RevertResult {
  deletedLodgings: number;
  deletedStays: number;
  detachedLodgings: number;
}

/**
 * Revert an import as a unit (spec §5). Deletes ONLY what this batch created.
 *
 * `LodgingStay.lodging` is `onDelete: Cascade` (schema.prisma) — deleting a
 * batch-created `Lodging` would cascade-delete EVERY stay under it, including
 * ones this batch never created: a stay the user added by hand afterwards
 * (`batchId = null`), or a stay committed by a LATER batch that matched this
 * lodging via `matchedLodgingId` (`createStay` stamps the CURRENT batch's id,
 * so that stay carries a different `batchId`). So a batch-created lodging is
 * only deleted if NO stays remain attached to it once this batch's own stays
 * are gone; if any stay survives (another batch's, or hand-made), the lodging
 * survives too and is merely detached (`batchId = null`) — none of its other
 * fields are touched. The same holds for photos and memberships the user
 * added to the house after the import (AUD-047).
 *
 * Runs as one interactive transaction (`$transaction(async (tx) => ...)`, not
 * the array form) because "which lodgings still have stays" must be queried
 * AFTER this batch's stays are deleted but BEFORE anything commits — the
 * array form can't branch on an intermediate result, and running that query
 * outside the transaction would race a concurrent write. Runs at
 * `Serializable` isolation (not the Postgres default READ COMMITTED) to
 * close that same TOCTOU window against a concurrent
 * `POST /lodgings/:id/stays`: without it, a stay attached to a batch-created
 * lodging between the stays count and the delete would still be visible as
 * "zero stays remaining" here and get cascade-deleted once this transaction
 * commits — exactly the data loss this function exists to prevent.
 *
 * Ownership check: `batchId` is client-supplied. `LodgingImportBatch` has its
 * own `userId` column with no compound FK to the caller — a plain existence
 * check would let user A revert user B's batch (same class of IDOR Task 7
 * fixed for `matchedLodgingId`). The `findFirst({ id, userId })` lookup runs
 * INSIDE the transaction, scoped to this user, before anything is read or
 * deleted; a batch that doesn't match either condition throws the friendly
 * 404 (indistinguishable from "batch doesn't exist") instead of surfacing a
 * raw Prisma P2025 if a concurrent request reverted the same batch first.
 */
export async function revertLodgingImportBatch(
  userId: string,
  batchId: string,
): Promise<RevertResult> {
  let orphanedPhotoFiles: string[] = [];
  const result = await prisma.$transaction(
    async (tx) => {
      // Scoped to the domain as well as the user: a flight batch reverted
      // through this path lost its log row while its flights stayed (AUD-046).
      const batch = await tx.importBatch.findFirst({
        where: { id: batchId, userId, domain: "lodging" },
      });
      if (!batch) throw new AppError("Import batch not found", 404);

      const stays = await tx.lodgingStay.deleteMany({ where: { userId, batchId } });

      // A house is "empty" only when NOTHING the user added afterwards hangs
      // from it. Stays were the only thing counted, so a hotel the import
      // created and the user then photographed was deleted with its photos —
      // "deletes only what this batch created" held for the stay and not for
      // the picture (AUD-047). Photos and loyalty memberships are the two
      // things a user curates on a house itself; either one keeps it.
      const batchLodgings = await tx.lodging.findMany({
        where: { userId, batchId },
        select: {
          id: true,
          _count: { select: { stays: true, photos: true, membershipLinks: true } },
        },
      });
      const isEmpty = (l: (typeof batchLodgings)[number]): boolean =>
        l._count.stays === 0 && l._count.photos === 0 && l._count.membershipLinks === 0;
      const emptyIds = batchLodgings.filter(isEmpty).map((l) => l.id);
      const occupiedIds = batchLodgings.filter((l) => !isEmpty(l)).map((l) => l.id);

      // Read before the delete, removed after the transaction commits — the
      // cascade takes the photo rows and with them the filenames (AUD-042).
      orphanedPhotoFiles = emptyIds.length
        ? await collectLodgingPhotoFilenames({ id: { in: emptyIds } })
        : [];
      const lodgings = emptyIds.length
        ? await tx.lodging.deleteMany({ where: { id: { in: emptyIds } } })
        : { count: 0 };
      const detached = occupiedIds.length
        ? await tx.lodging.updateMany({
            where: { id: { in: occupiedIds } },
            data: { batchId: null },
          })
        : { count: 0 };

      await tx.importBatch.delete({ where: { id: batchId } });

      return {
        deletedStays: stays.count,
        deletedLodgings: lodgings.count,
        detachedLodgings: detached.count,
      };
    },
    { isolationLevel: "Serializable" },
  );

  logger.info(
    {
      operation: "lodging_import_revert",
      userId,
      batchId,
      deletedStays: result.deletedStays,
      deletedLodgings: result.deletedLodgings,
      detachedLodgings: result.detachedLodgings,
    },
    "Lodging import batch reverted",
  );

  removeLodgingPhotoFiles(orphanedPhotoFiles);
  return result;
}
