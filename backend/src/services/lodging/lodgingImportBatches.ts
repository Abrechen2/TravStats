import { prisma } from "../../db";
import logger from "../../utils/logger";
import { AppError } from "../../middleware/errorHandler";
import {
  IMPORT_SOURCES,
  type LodgingImportBatchSummary,
  type LodgingImportSource,
} from "../../schemas/lodgingImport";

/** The column is a plain String; narrow it back to the union on the way out. */
function asSource(value: string): LodgingImportSource {
  return (IMPORT_SOURCES as readonly string[]).includes(value)
    ? (value as LodgingImportSource)
    : "csv";
}

export async function listLodgingImportBatches(
  userId: string,
): Promise<LodgingImportBatchSummary[]> {
  const batches = await prisma.lodgingImportBatch.findMany({
    where: { userId },
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
}

/**
 * Revert an import as a unit (spec §5). Deletes the stays and lodgings the batch
 * CREATED — a stay the batch added to a lodging the user already had is removed,
 * but that lodging is not (its `batchId` is null).
 *
 * One transaction, stays first: they FK the lodgings, and deleting the lodgings
 * first would cascade the stays away before `deleteMany` could count them.
 *
 * Ownership check: `batchId` is client-supplied. `LodgingImportBatch` has its own
 * `userId` column with no compound FK to the caller — a plain existence check
 * would let user A revert user B's batch (same class of IDOR Task 7 fixed for
 * `matchedLodgingId`). `findFirst({ id, userId })` scopes the lookup to this
 * user before anything is read or deleted; a batch that doesn't match either
 * condition throws 404, indistinguishable from "batch doesn't exist" so as not
 * to leak whether the id belongs to someone else.
 */
export async function revertLodgingImportBatch(
  userId: string,
  batchId: string,
): Promise<RevertResult> {
  const batch = await prisma.lodgingImportBatch.findFirst({ where: { id: batchId, userId } });
  if (!batch) throw new AppError("Import batch not found", 404);

  const [stays, lodgings] = await prisma.$transaction([
    prisma.lodgingStay.deleteMany({ where: { userId, batchId } }),
    prisma.lodging.deleteMany({ where: { userId, batchId } }),
    prisma.lodgingImportBatch.delete({ where: { id: batchId } }),
  ]);

  logger.info(
    {
      operation: "lodging_import_revert",
      userId,
      batchId,
      deletedStays: stays.count,
      deletedLodgings: lodgings.count,
    },
    "Lodging import batch reverted",
  );

  return { deletedLodgings: lodgings.count, deletedStays: stays.count };
}
