import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import {
  PLACE_IMPORT_FAILURE_MESSAGES,
  type PlaceImportCandidate,
  type PlaceImportFailureCode,
  type PlaceImportSource,
} from "../../schemas/placeImport";

const UNIQUE_VIOLATION = "P2002";

export interface PlaceImportFailure {
  sourceRowIndex: number;
  code: PlaceImportFailureCode;
  error: string;
}

export interface PlaceCommitResult {
  batchId: string;
  created: number;
  /** Already here. Not an error — this is what makes a re-import a no-op. */
  skipped: number;
  failed: PlaceImportFailure[];
}

/**
 * Commit a POI import as one revertible batch — POI Phase D §5.
 *
 * The properties below are copied from `lodgingImportCommit` on purpose; each
 * of them was learned somewhere more expensive than here.
 *
 * - Every row is written in its own try/catch: **a failed row never fails the
 *   batch.** A file of 300 places must not be lost to row 41.
 * - A unique-constraint hit on `externalRef` is a SKIP, not a failure. That is
 *   precisely what lets someone re-run the same file after resolving a few more
 *   rows and get only the new ones.
 * - Failures collapse to a fixed vocabulary. This response is a 201 body, so
 *   the error handler's leak protections never run on it and a raw Prisma
 *   message would go straight to the client.
 * - No geocoding happens here. A row without coordinates is not written at all
 *   — the preview already offered it to the user, and `Place` is a point.
 */
export async function commitPlaceImport(
  userId: string,
  source: PlaceImportSource,
  fileName: string | null,
  rows: readonly PlaceImportCandidate[]
): Promise<PlaceCommitResult> {
  const batch = await prisma.importBatch.create({
    data: { userId, domain: "poi", source, fileName },
  });

  let created = 0;
  let skipped = 0;
  const failed: PlaceImportFailure[] = [];

  for (const row of rows) {
    try {
      const hasPosition =
        typeof row.lat === "number" &&
        typeof row.lon === "number" &&
        Number.isFinite(row.lat) &&
        Number.isFinite(row.lon);

      if (!hasPosition) {
        // Reported rather than silently dropped: the user is told which of
        // their rows did not make it, by name, so they can judge whether
        // anything they cared about is missing.
        failed.push({
          sourceRowIndex: row.sourceRowIndex,
          code: "no_position",
          error: PLACE_IMPORT_FAILURE_MESSAGES.no_position,
        });
        continue;
      }

      const visitedAt = row.visitedAt ? new Date(row.visitedAt) : null;
      const usableVisitedAt = visitedAt && !Number.isNaN(visitedAt.getTime()) ? visitedAt : null;

      await prisma.place.create({
        data: {
          userId,
          batchId: batch.id,
          name: row.name.trim(),
          lat: row.lat as number,
          lon: row.lon as number,
          // `Place.category` is NOT NULL with a default; passing null would be
          // rejected, and inventing a category would be worse. Omitting it lets
          // the schema's own default stand.
          ...(row.category?.trim() ? { category: row.category.trim() } : {}),
          address: row.address?.trim() || null,
          city: row.city?.trim() || null,
          country: row.country?.trim() || null,
          notes: row.notes?.trim() || null,
          externalRef: row.externalRef?.trim() || null,
          // A place imported WITH a date is one the user has been to; without
          // one it is a place they saved. Both are honest, and the difference
          // is exactly what `visited` means in this domain.
          visited: usableVisitedAt !== null,
          dataSource: "import",
        },
      });
      created += 1;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
        skipped += 1;
        continue;
      }
      logger.warn({ err, userId, sourceRowIndex: row.sourceRowIndex }, "[Place Import] Row failed");
      failed.push({
        sourceRowIndex: row.sourceRowIndex,
        code: "write_failed",
        error: PLACE_IMPORT_FAILURE_MESSAGES.write_failed,
      });
    }
  }

  logger.info(
    {
      operation: "place_import_commit",
      context: { userId, batchId: batch.id, created, skipped, failed: failed.length },
    },
    "[Place Import] Commit complete"
  );

  return { batchId: batch.id, created, skipped, failed };
}
