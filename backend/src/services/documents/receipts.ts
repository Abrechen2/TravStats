import fs from "fs";
import path from "path";

import { prisma } from "../../db";
import { getUploadDir } from "../../middleware/upload";
import logger from "../../utils/logger";
import { createDocument } from "./documentService";
import { fileIfUnfiled, inLinkTransaction, removeLinks } from "./documentLinks";
import { receiptUrlForms } from "../files/privateFileUrls";

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

/**
 * The provenance of the links this file manages. A receipt is filed because an
 * entry's `receiptUrl` names it — the old single-owner mechanism — so its link
 * is `legacy`, and only `legacy` links are ever taken off again here.
 */
const RECEIPT_PROVENANCE = "legacy" as const;

const DOCUMENT_URL = /^\/api\/v1\/documents\/([0-9a-f-]{36})\/file$/i;

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
    const entry = {
      type: ref.column === "flightId" ? ("flight" as const) : ("lodgingStay" as const),
      id: ref.id,
    };
    const done = await inLinkTransaction((tx) =>
      fileIfUnfiled(tx, ref.userId, ref.documentId, entry, { provenance: RECEIPT_PROVENANCE })
    );
    if (done) filed += 1;
  }

  // Only the links this run manages: a receipt's filing link on a flight or a
  // stay (provenance `legacy`). A link the user or a parser made stays even
  // when no `receiptUrl` names it (plan, lifecycle).
  const named = new Set(references.map((r) => `${r.column}:${r.id}:${r.documentId}`));
  const managed = await prisma.documentLink.findMany({
    where: {
      provenance: RECEIPT_PROVENANCE,
      document: { source: RECEIPT_SOURCE },
      OR: [{ flightId: { not: null } }, { lodgingStayId: { not: null } }],
    },
    select: { id: true, documentId: true, flightId: true, lodgingStayId: true },
  });
  const orphaned = managed
    .filter((l) =>
      l.flightId
        ? !named.has(`flightId:${l.flightId}:${l.documentId}`)
        : !named.has(`lodgingStayId:${l.lodgingStayId}:${l.documentId}`)
    )
    .map((l) => l.id);
  if (orphaned.length > 0) {
    await inLinkTransaction((tx) => removeLinks(tx, orphaned));
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

    // Both forms of the old URL: the one the upload route wrote, and the
    // extension-less one it redirects to (forgejo#284).
    const legacyUrl = { in: receiptUrlForms(upload.filename) };
    const next = { receiptUrl: receiptUrlFor(documentId) };
    await prisma.$transaction([
      // share-exempt: receipt links — private
      prisma.flight.updateMany({
        where: { userId: upload.userId, receiptUrl: legacyUrl },
        data: next,
      }),
      // share-exempt: receipt links — private
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
