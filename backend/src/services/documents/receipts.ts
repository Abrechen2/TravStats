import fs from "fs";
import path from "path";

import { prisma } from "../../db";
import { getUploadDir } from "../../middleware/upload";
import logger from "../../utils/logger";
import { createDocument } from "./documentService";

/**
 * Receipts are kept documents (forgejo#116, owner decision 2026-09-17).
 *
 * A flight or a stay still carries its receipt as `receiptUrl` — the web forms
 * read and write that field, and nothing about them had to change. What
 * changed is what the URL names: `POST /uploads/receipt` stores the file as a
 * Document (source `receipt`, kind `invoice`) and answers its
 * `/api/v1/documents/<id>/file`.
 *
 * Filing follows the reference, and in ONE place, the hourly document run: a
 * receipt document is filed with the entry whose `receiptUrl` names it, and
 * taken off again once no entry does. Create, update, the batch import and a
 * merge all write `receiptUrl`, and a rule enforced in each of those routes
 * would hold only for the routes someone remembered. An unfiled document lives
 * seven days, so the hour in between loses nothing.
 *
 * Ownership is the document's, as it was the upload's (AUD-019): an entry that
 * names somebody else's document URL files nothing and reads nothing.
 */

export const RECEIPT_SOURCE = "receipt";

const DOCUMENT_URL = /^\/api\/v1\/documents\/([0-9a-f-]{36})\/file$/i;
const LEGACY_PREFIX = "/api/v1/uploads/receipts/";

export function receiptUrlFor(documentId: string): string {
  return `/api/v1/documents/${documentId}/file`;
}

export function documentIdFromReceiptUrl(url: string | null | undefined): string | null {
  return url ? (DOCUMENT_URL.exec(url)?.[1]?.toLowerCase() ?? null) : null;
}

export interface ReceiptReconcileResult {
  filed: number;
  unfiled: number;
}

/** Files receipt documents with the entries that name them, and unfiles the ones nothing names. */
export async function reconcileReceiptDocuments(): Promise<ReceiptReconcileResult> {
  const referencing = { receiptUrl: { startsWith: "/api/v1/documents/" } };
  const [flights, stays] = await Promise.all([
    prisma.flight.findMany({
      where: referencing,
      select: { id: true, userId: true, receiptUrl: true },
    }),
    prisma.lodgingStay.findMany({
      where: referencing,
      select: { id: true, userId: true, receiptUrl: true },
    }),
  ]);
  const references = [
    ...flights.map((f) => ({ ...f, column: "flightId" as const })),
    ...stays.map((s) => ({ ...s, column: "lodgingStayId" as const })),
  ]
    .map((r) => ({ ...r, documentId: documentIdFromReceiptUrl(r.receiptUrl) }))
    .filter((r): r is typeof r & { documentId: string } => r.documentId !== null);

  let filed = 0;
  for (const ref of references) {
    // Unfiled, and the entry's owner's own: only then. A document filed with
    // something else stays where it is; a stranger's stays out of reach.
    const { count } = await prisma.document.updateMany({
      where: {
        id: ref.documentId,
        userId: ref.userId,
        flightId: null,
        cruiseId: null,
        lodgingStayId: null,
        tripId: null,
        placeVisitId: null,
        railJourneyId: null,
      },
      data: { [ref.column]: ref.id, linkedAt: new Date() },
    });
    filed += count;
  }

  const named = new Set(references.map((r) => `${r.column}:${r.id}:${r.documentId}`));
  const filedReceipts = await prisma.document.findMany({
    where: {
      source: RECEIPT_SOURCE,
      OR: [{ flightId: { not: null } }, { lodgingStayId: { not: null } }],
    },
    select: { id: true, flightId: true, lodgingStayId: true },
  });
  const orphaned = filedReceipts
    .filter((d) =>
      d.flightId
        ? !named.has(`flightId:${d.flightId}:${d.id}`)
        : !named.has(`lodgingStayId:${d.lodgingStayId}:${d.id}`)
    )
    .map((d) => d.id);
  if (orphaned.length > 0) {
    await prisma.document.updateMany({
      where: { id: { in: orphaned } },
      data: { flightId: null, lodgingStayId: null, linkedAt: null },
    });
  }

  if (filed > 0 || orphaned.length > 0) {
    logger.info(
      { operation: "receipt_documents_reconciled", filed, unfiled: orphaned.length },
      "Receipt documents follow their references"
    );
  }
  return { filed, unfiled: orphaned.length };
}

/**
 * One-off, idempotent: receipts uploaded before they were documents.
 *
 * Each `ReceiptUpload` becomes a Document owned by the same user, every flight
 * and stay of that user naming the old URL is pointed at the new one, and the
 * old row and file go. A file that is missing or that is no longer an accepted
 * format (a GIF) is left exactly as it was and logged — the old routes still
 * serve it — rather than dropped.
 */
export async function migrateLegacyReceipts(): Promise<{ migrated: number; skipped: number }> {
  const uploads = await prisma.receiptUpload.findMany({ select: { filename: true, userId: true } });
  let migrated = 0;
  let skipped = 0;

  for (const upload of uploads) {
    const filePath = path.join(getUploadDir(), path.basename(upload.filename));
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch {
      skipped++;
      continue;
    }
    let documentId: string;
    try {
      const { document } = await createDocument({
        userId: upload.userId,
        buffer,
        originalName: upload.filename,
        source: RECEIPT_SOURCE,
        kind: "invoice",
      });
      documentId = document.id;
    } catch (error) {
      skipped++;
      logger.warn(
        {
          operation: "legacy_receipt_not_migrated",
          filename: upload.filename,
          error: { message: (error as Error).message },
        },
        "A legacy receipt stays where it is"
      );
      continue;
    }

    const legacyUrl = `${LEGACY_PREFIX}${upload.filename}`;
    const next = { receiptUrl: receiptUrlFor(documentId) };
    await prisma.$transaction([
      prisma.flight.updateMany({
        where: { userId: upload.userId, receiptUrl: legacyUrl },
        data: next,
      }),
      prisma.lodgingStay.updateMany({
        where: { userId: upload.userId, receiptUrl: legacyUrl },
        data: next,
      }),
      prisma.receiptUpload.delete({ where: { filename: upload.filename } }),
    ]);
    fs.rmSync(filePath, { force: true });
    migrated++;
  }

  if (migrated > 0 || skipped > 0) {
    logger.info(
      { operation: "legacy_receipts_migrated", migrated, skipped },
      "Legacy receipts moved to documents"
    );
  }
  return { migrated, skipped };
}
