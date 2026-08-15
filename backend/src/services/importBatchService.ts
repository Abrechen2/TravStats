import { prisma } from "../db";
import { AppError } from "../middleware/errorHandler";
import { revertLodgingImportBatch } from "./lodging/lodgingImportBatches";

/**
 * Import batches across every domain.
 *
 * Stays had this since 2.6.0; flights and cruises wrote their rows and left no
 * trace, so "undo this import" existed for one area out of three. The record
 * is the same for all of them — only the reversal differs, because what a row
 * drags along when it goes differs per domain.
 */

export const IMPORT_DOMAINS = ["flight", "cruise", "lodging"] as const;
export type ImportDomain = (typeof IMPORT_DOMAINS)[number];

export const IMPORT_SOURCES = ["csv", "email", "pdf"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export interface ImportBatchSummary {
  id: string;
  domain: ImportDomain;
  source: ImportSource;
  fileName: string | null;
  createdAt: string;
  /** How many rows this batch still owns, per kind. */
  counts: { lodgings: number; stays: number; flights: number; cruises: number };
}

function asDomain(value: string): ImportDomain {
  return (IMPORT_DOMAINS as readonly string[]).includes(value) ? (value as ImportDomain) : "lodging";
}

function asSource(value: string): ImportSource {
  return (IMPORT_SOURCES as readonly string[]).includes(value) ? (value as ImportSource) : "csv";
}

export async function createImportBatch(
  userId: string,
  domain: ImportDomain,
  source: ImportSource,
  fileName: string | null,
): Promise<{ id: string }> {
  const batch = await prisma.importBatch.create({
    data: { userId, domain, source, fileName },
    select: { id: true },
  });
  return batch;
}

/**
 * An import that imported nothing is not an import.
 *
 * A batch is opened when a document is read, before anyone knows whether it
 * will produce rows — and a mail read a second time produces none, because
 * every flight in it is already here. Listing that as a run would invite the
 * user to "undo" an import that never happened, and would fill the log with
 * entries that say nothing. The record stays in the database (it costs a row
 * and keeps the id stable if something else ever references it); it simply is
 * not a run worth showing.
 */
export async function listImportBatches(userId: string): Promise<ImportBatchSummary[]> {
  const batches = await prisma.importBatch.findMany({
    where: {
      userId,
      OR: [
        { lodgings: { some: {} } },
        { stays: { some: {} } },
        { flights: { some: {} } },
        { cruises: { some: {} } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { lodgings: true, stays: true, flights: true, cruises: true } },
    },
  });

  return batches.map((b) => ({
    id: b.id,
    domain: asDomain(b.domain),
    source: asSource(b.source),
    fileName: b.fileName,
    createdAt: b.createdAt.toISOString(),
    counts: {
      lodgings: b._count.lodgings,
      stays: b._count.stays,
      flights: b._count.flights,
      cruises: b._count.cruises,
    },
  }));
}

export interface RevertSummary {
  domain: ImportDomain;
  deleted: number;
  /** Lodging only: rows that survived because something else still needs them. */
  detached?: number;
}

/**
 * Takes an import back as a unit.
 *
 * Ownership is checked here rather than by the caller: `batchId` arrives from
 * the client, and a plain existence check would let one user revert another's
 * import. A batch that is not theirs is simply not found.
 *
 * Flights and cruises are deleted outright — that is what undo means, and the
 * rows they own (companion links, stops, legs) go with them by cascade. An
 * auto-created trip left empty behind them is deliberately NOT deleted: it may
 * carry a name, photos or a journal the user wrote, and there is already a
 * tool for clearing empty ones. Stays keep their own, more careful reversal,
 * which refuses to cascade-delete a hotel that other stays still hang from.
 */
export async function revertImportBatch(userId: string, batchId: string): Promise<RevertSummary> {
  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, userId },
    select: { id: true, domain: true },
  });
  if (!batch) throw new AppError("Import batch not found", 404);

  const domain = asDomain(batch.domain);

  if (domain === "lodging") {
    const result = await revertLodgingImportBatch(userId, batchId);
    return {
      domain,
      deleted: result.deletedLodgings + result.deletedStays,
      detached: result.detachedLodgings,
    };
  }

  return await prisma.$transaction(async (tx) => {
    // Scoped by userId as well as the batch: the batch was already proven to
    // belong to this user, and the second condition keeps that true even if a
    // row were ever stamped with someone else's batch.
    const where = { userId, importBatchId: batchId };
    const deleted =
      domain === "flight"
        ? (await tx.flight.deleteMany({ where })).count
        : (await tx.cruise.deleteMany({ where })).count;
    await tx.importBatch.delete({ where: { id: batchId } });
    return { domain, deleted };
  });
}
