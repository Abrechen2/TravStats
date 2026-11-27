import path from "path";

import type { Document, Prisma } from "../../prisma";

import { listEntryDocuments } from "./documentEntryLinks";
import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { documentIdsBodySchema } from "../../schemas/document";
import {
  DOCUMENT_KINDS,
  type RentalDocumentCategory,
  detectDocumentFormat,
  type DocumentFormat,
  exceededLimit,
  type DetectedFormat,
  type DocumentKind,
} from "./documentFormats";
import {
  DOCUMENT_DIR,
  removeDocumentFile,
  storedNameFor,
  sha256Hex,
  writeDocumentFile,
} from "./documentStore";
import type { ExtractedValues } from "./documentValues";
import { storedReading } from "./storedReading";
import { countPdfPages } from "../pdfPageCount";
import { sweepUploadDir } from "../files/uploadSweep";
import {
  assertEntryOwnedIn,
  entryOfColumns,
  fileIfUnfiled,
  inLinkTransaction,
  LINK_TARGETS,
  lockDocument,
  lockDocuments,
  type EntryRef,
  type LinkProvenance,
  setPrimaryLink,
  targetColumns,
} from "./documentLinks";
import { uploadFileAgeMs } from "../files/uploadFiles";

/**
 * Kept originals, filed with the entry they produced (forgejo#116).
 *
 * The rules this file holds, each an owner decision of 2026-09-16:
 *
 *  - A document is FILED with at most one entry (also a CHECK in the database).
 *    Since the document-links plan (2026-11-21) that entry is the primary of
 *    the document's links (`documentLinks.ts`), and the owner columns are its
 *    projection; every filing write below goes through that file.
 *  - An upload is IDEMPOTENT per sha256 and target. The Companion queues
 *    originals while offline and flushes them in a burst; a retried send must
 *    return the document it already made, not a second copy.
 *  - Linking works at creation (`documentIds` on the create routes) AND
 *    afterwards, because an offline capture's document can arrive after its
 *    entry.
 *  - Deleting an entry removes its links, not the document (plan rule 5): the
 *    link cascades, the owner column is `SET NULL`, and a document left with
 *    no link becomes unfiled and gets the same 30-day grace as one unfiled by
 *    hand (trigger `document_links_after_delete`). Every path that can delete
 *    an entry — its own route, its lodging or place, a trip, a restore — is
 *    covered by that one rule in the database. The BYTES go with the hourly
 *    sweep, the one place that removes a file whose row is gone.
 *  - An upload that is never filed expires (UNLINKED_TTL_DAYS).
 *
 * Logs carry id, format and size — never content, never the file name.
 */

export { ENTRY_TYPES, type EntryType } from "./documentFormats";
export type { EntryRef } from "./documentLinks";

/**
 * How the row came to be. `parse` (a parse route kept its input), `mail` (the mail intake fetched it) and `receipt`
 * (the receipt upload, see receipts.ts) are the server's own; a client may say
 * `upload` or `companion`, nothing else.
 */
export const DOCUMENT_SOURCES = ["upload", "companion", "parse", "receipt", "mail"] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

/**
 * The MIME type a declared format stands for, used ONLY as the detection hint
 * for the formats that have no byte signature of their own. A React Native
 * multipart part often arrives as `application/octet-stream`, which would make
 * a mail file or a Wallet pass unrecognisable although the client said what it is.
 */
const FORMAT_HINT_MIME: Partial<Record<DocumentFormat, string>> = {
  eml: "message/rfc822",
  emailText: "text/plain",
  pkpass: "application/vnd.apple.pkpass",
};

/**
 * Unfiled uploads older than this are removed by the sweep.
 *
 * It was 7, and nothing anywhere said so — not a locale string, not a screen.
 * A boarding pass uploaded from the Companion and never filed simply stopped
 * existing, row and bytes, a week later (2026-09-19 integrity audit, finding
 * 4). Thirty days is the owner's number, and the deletion is now announced:
 * `GET /documents/unfiled` carries `deletesAt`, and the inbox's review tab
 * lists every unfiled document with the date it goes.
 *
 * Change this and the date on screen follows, because both read
 * `unfiledDeletesAt`.
 */
export const UNLINKED_TTL_DAYS = 30;

/**
 * When an unfiled document will be swept, or null when it is not unfiled — or
 * is unfiled without a stamp, which no write path produces and the migration
 * backfilled away.
 *
 * Measured from `unlinkedAt`, NOT `createdAt`. `createdAt` is the age of the
 * FILE; the TTL is about the age of the PROBLEM. Unfiling a document uploaded
 * two months ago put it past a `createdAt` TTL the instant it was unfiled, so
 * the next hourly pass deleted it — while the inbox, reading the same column,
 * had just shown a deletion date in the past.
 *
 * Null rather than a guess, so this and `sweepDocuments` abstain on the same
 * rows: a document nobody can date is a document nobody deletes.
 */
export function unfiledDeletesAt(document: Pick<Document, "unlinkedAt">): Date | null {
  if (!document.unlinkedAt) return null;
  return new Date(document.unlinkedAt.getTime() + UNLINKED_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * How many unfiled documents one request may list. A bound, not a page: the
 * block this feeds is a warning, and a user with more than fifty unfiled
 * uploads has a filing problem the list cannot solve by being longer.
 */
export const UNFILED_LIST_LIMIT = 50;

/**
 * A user's own unfiled documents, newest first, each with the date it will be
 * removed. The counterpart of the sweep: nothing may be deleted here that the
 * user was not first shown.
 */
export async function listUnfiledDocuments(
  userId: string,
  limit: number = UNFILED_LIST_LIMIT
): Promise<Document[]> {
  return prisma.document.findMany({
    where: { userId, ...NO_OWNER },
    // By when it became unfiled, not when it was uploaded: that is the order of
    // the deadline the list is about. `id` breaks the tie, because `unlinkedAt`
    // is neither unique nor — on rows the migration backfilled — distinct.
    orderBy: [{ unlinkedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}

const NO_OWNER: Prisma.DocumentWhereInput = {
  flightId: null,
  cruiseId: null,
  lodgingStayId: null,
  tripId: null,
  placeVisitId: null,
  railJourneyId: null,
  rentalBookingId: null,
  busJourneyId: null,
  ferryJourneyId: null,
  tripExpenseId: null,
  tripRouteId: null,
};

function ownerWhere(entry: EntryRef): Prisma.DocumentWhereInput {
  return { [LINK_TARGETS[entry.type].column]: entry.id };
}

export function entryOf(document: Document): EntryRef | null {
  return entryOfColumns(document);
}

/** 404 unless the entry exists AND belongs to the user — a stranger's entry is not an entry. */
export async function assertEntryOwned(userId: string, entry: EntryRef): Promise<void> {
  await assertEntryOwnedIn(prisma, userId, entry);
}

export interface CreateDocumentInput {
  userId: string;
  buffer: Buffer;
  originalName?: string;
  declaredMime?: string;
  /** Set for text the server received as text (a pasted mail), where no file name exists. */
  forceFormat?: DetectedFormat;
  /**
   * What the client says the file is. A hint for the text and ZIP formats, and
   * a claim the bytes must bear out: an upload declared as a PDF that is a JPEG
   * is refused rather than silently filed as something else.
   */
  declaredFormat?: DocumentFormat;
  source?: DocumentSource;
  kind?: DocumentKind | null;
  issuedOn?: Date | null;
  parsedDomain?: string | null;
  parsedPayload?: Prisma.InputJsonValue | null;
  entry?: EntryRef | null;
  /** A rental's evidence category (forgejo#239); only with a rentalBooking entry. */
  rentalCategory?: RentalDocumentCategory | null;
  /**
   * Always write a row of its own, even when the same bytes are already filed (or unfiled) on the
   * account. Every check above still runs; the stored file is shared by content name, so only the
   * row is new. A plan upload uses it so that an upload never behaves differently, or fails
   * differently, because the owner happens to hold the same file.
   */
  separateRow?: boolean;
  /** How the filing link came to be (plan rule 3); `user` unless the caller says otherwise. */
  linkProvenance?: LinkProvenance;
}

export interface CreateDocumentResult {
  document: Document;
  /** False when an identical upload was already on file and was returned instead. */
  created: boolean;
}

function sanitizeOriginalName(name: string | undefined): string | null {
  if (!name) return null;
  const base = [...name]
    .filter((c) => c.charCodeAt(0) >= 0x20)
    .join("")
    .replace(/[\\/]/g, "_")
    .trim();
  return base ? base.slice(0, 200) : null;
}

export type FormatCheckInput = Pick<
  CreateDocumentInput,
  "buffer" | "originalName" | "declaredMime" | "forceFormat" | "declaredFormat"
>;

/**
 * What the bytes are, or the 415/413 a client can act on. Exported so a parse
 * route asked to keep its input can refuse BEFORE the expensive parse rather
 * than after it.
 */
export function checkDocumentFormat(input: FormatCheckInput): DetectedFormat {
  const hintMime = input.declaredFormat ? FORMAT_HINT_MIME[input.declaredFormat] : undefined;
  const detected =
    input.forceFormat ??
    detectDocumentFormat(input.buffer, input.originalName, hintMime ?? input.declaredMime);
  if (detected && input.declaredFormat && detected.format !== input.declaredFormat) {
    throw new AppError(
      `Document declared as ${input.declaredFormat} but its content is ${detected.format}.`,
      415
    );
  }
  if (!detected) {
    throw new AppError(
      "Unsupported document. Accepted: JPEG, PNG, WebP or HEIC images, PDF, .eml mail files, plain text, Wallet passes (.pkpass).",
      415
    );
  }
  const limit = exceededLimit(detected.format, input.buffer.length);
  if (limit !== null) {
    throw new AppError(
      `Document too large: ${detected.format} may be at most ${limit / (1024 * 1024)} MB.`,
      413
    );
  }
  return detected;
}

export async function createDocument(input: CreateDocumentInput): Promise<CreateDocumentResult> {
  const detected = checkDocumentFormat(input);
  if (input.kind && !DOCUMENT_KINDS.includes(input.kind))
    throw new AppError("Unknown document kind", 400);

  const entry = input.entry ?? null;
  const provenance = input.linkProvenance ?? "user";
  assertCategoryFits(input.rentalCategory, entry);
  if (entry) await assertEntryOwned(input.userId, entry);

  const sha256 = sha256Hex(input.buffer);

  // Idempotency: the same bytes for the same target are the same document.
  const sameTarget = input.separateRow
    ? null
    : await prisma.document.findFirst({
        where: { userId: input.userId, sha256, ...(entry ? ownerWhere(entry) : NO_OWNER) },
      });
  if (sameTarget) {
    // The same file sent again for the same rental under a category: a still
    // uncategorised copy takes it (review, minor 4). One already filed under
    // another category keeps it — the answer carries that one, and the client
    // says so rather than pretending the new choice was applied.
    if (input.rentalCategory && sameTarget.rentalCategory === null && entry) {
      const document = await inLinkTransaction((tx) =>
        setPrimaryLink(tx, input.userId, sameTarget.id, entry, {
          provenance,
          rentalCategory: input.rentalCategory,
        })
      );
      return { document, created: false };
    }
    return { document: sameTarget, created: false };
  }

  // A retried offline send may arrive with a target after the first attempt
  // went up unfiled: file that one rather than keeping two copies.
  if (entry && !input.separateRow) {
    const unfiled = await prisma.document.findFirst({
      where: { userId: input.userId, sha256, ...NO_OWNER },
    });
    if (unfiled) {
      // Filed now, so filed with the category the user chose (re-review,
      // fix round 3) — `assertCategoryFits` already held it to a rental.
      const document = await inLinkTransaction((tx) =>
        setPrimaryLink(tx, input.userId, unfiled.id, entry, {
          provenance,
          ...(input.rentalCategory && { rentalCategory: input.rentalCategory }),
        })
      );
      return { document, created: false };
    }
  }

  const pageCount = detected.format === "pdf" ? await countPdfPages(input.buffer) : null;
  const storedName = storedNameFor(sha256, detected.extension);
  await writeDocumentFile(storedName, input.buffer);
  try {
    const document = await inLinkTransaction(async (tx) => {
      const row = await tx.document.create({
        data: {
          userId: input.userId,
          storedName,
          originalName: sanitizeOriginalName(input.originalName),
          mimetype: detected.mimetype,
          sizeBytes: input.buffer.length,
          sha256,
          pageCount,
          format: detected.format,
          kind: input.kind ?? null,
          issuedOn: input.issuedOn ?? null,
          source: input.source ?? "upload",
          parsedDomain: input.parsedDomain ?? null,
          ...(input.parsedPayload != null && { parsedPayload: input.parsedPayload }),
          ...targetColumns(null),
          unlinkedAt: new Date(),
        },
      });
      // Filed through its link, in the same transaction: the row never
      // exists without the link its owner columns describe.
      return entry
        ? setPrimaryLink(tx, input.userId, row.id, entry, {
            provenance,
            rentalCategory: input.rentalCategory ?? null,
          })
        : row;
    });
    logger.info(
      {
        operation: "document_created",
        documentId: document.id,
        format: document.format,
        sizeBytes: document.sizeBytes,
      },
      "Document kept"
    );
    // A delete of the last other row may have removed the file between the
    // write above and this insert; the row now names it, so it must exist.
    await writeDocumentFile(storedName, input.buffer);
    return { document, created: true };
  } catch (error) {
    await releaseDocumentFiles([storedName]);
    throw error;
  }
}

/**
 * Removes each named file that no row names any more. Call it AFTER the rows
 * are gone. A file named by its content may be shared by rows of other
 * entries or other accounts, so a row's delete is never by itself a reason to
 * delete the bytes.
 */
export async function releaseDocumentFiles(storedNames: readonly string[]): Promise<void> {
  const unique = [...new Set(storedNames)];
  if (unique.length === 0) return;
  const stillNamed = new Set(
    (
      await prisma.document.findMany({
        where: { storedName: { in: unique } },
        select: { storedName: true },
      })
    ).map((row) => row.storedName)
  );
  for (const name of unique) {
    if (!stillNamed.has(name)) await removeDocumentFile(name);
  }
}

/**
 * Checks that every id is the user's and can be filed with `entry` — unfiled,
 * or already filed there. Run BEFORE an entry is created, so a bad id fails the
 * create instead of leaving an entry whose documents never attached.
 */
export async function assertLinkable(
  userId: string,
  ids: readonly string[],
  entry?: EntryRef
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const documents = await prisma.document.findMany({ where: { id: { in: unique }, userId } });
  if (documents.length !== unique.length) throw new AppError("Document not found", 404);
  for (const document of documents) {
    const current = entryOf(document);
    const sameEntry = entry && current && current.type === entry.type && current.id === entry.id;
    if (current && !sameEntry) {
      throw new AppError("Document is already filed with another entry", 409);
    }
  }
}

/**
 * The `documentIds` of a create request, checked BEFORE the entry is written: an
 * unknown, foreign or already-filed id fails the create rather than leaving an
 * entry whose documents never attached. File them with `linkDocuments` once the
 * entry exists.
 */
export async function takeDocumentIds(userId: string, body: unknown): Promise<string[]> {
  const parsed = documentIdsBodySchema.safeParse(body ?? {});
  if (!parsed.success)
    throw new AppError("documentIds must be a list of at most 20 document ids", 400);
  const ids = parsed.data.documentIds ?? [];
  await assertLinkable(userId, ids);
  return ids;
}

/** Files documents with an entry. Idempotent: already filed there is fine. */
export async function linkDocuments(
  userId: string,
  ids: readonly string[],
  entry: EntryRef
): Promise<Document[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  await assertEntryOwned(userId, entry);
  await assertLinkable(userId, unique, entry);
  await inLinkTransaction((tx) => linkDocumentsInTx(tx, userId, unique, entry));
  return prisma.document.findMany({
    where: { id: { in: unique }, userId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * `linkDocuments` for a caller that writes the entry inside its own
 * transaction (the package-tour commit files the document on a trip created
 * a moment earlier in the same transaction). The caller has already run
 * `assertLinkable` for these ids; only a document with no link yet is filed
 * (checked under its row lock), so one filed elsewhere in the meantime stays
 * where it is, and the count tells the caller whether that happened.
 */
export async function linkDocumentsInTx(
  tx: DbTransaction,
  userId: string,
  ids: readonly string[],
  entry: EntryRef,
  provenance: LinkProvenance = "user"
): Promise<number> {
  let count = 0;
  for (const id of new Set(ids)) {
    if (await fileIfUnfiled(tx, userId, id, entry, { provenance })) count += 1;
  }
  return count;
}

/**
 * `linkDocumentsInTx` for a create that must not outlive its receipts: a
 * document filed elsewhere since `takeDocumentIds` checked it throws 409,
 * which rolls the caller's transaction (and its client-ref claim) back.
 */
export async function fileReceipts(
  tx: DbTransaction,
  userId: string,
  ids: readonly string[],
  entry: EntryRef
): Promise<void> {
  if ((await linkDocumentsInTx(tx, userId, ids, entry)) !== new Set(ids).size)
    throw new AppError("A document was linked elsewhere during creation", 409);
}

/** Takes a document off its entry; it becomes unfiled and expires unless filed again. */
export async function unlinkDocument(userId: string, id: string): Promise<Document> {
  const document = await getOwnDocument(userId, id);
  // Only the primary link, never every link (plan, Companion section): an
  // older app that unfiles a document means the entry it shows it under.
  return inLinkTransaction((tx) =>
    setPrimaryLink(tx, userId, document.id, null, { provenance: "user" })
  );
}

export interface UpdateDocumentInput {
  /** Stored as the original name: the on-disk name is generated and never changes. */
  displayName?: string;
  /** The owner's remark; null clears it; absent leaves it. */
  note?: string | null;
  kind?: DocumentKind | null;
  issuedOn?: Date | null;
  /** An entry files it there; null takes it off its entry; absent leaves it. */
  entry?: EntryRef | null;
  /** A rental evidence category; null uncategorises; absent leaves it (forgejo#239). */
  rentalCategory?: RentalDocumentCategory | null;
}

/**
 * A category belongs to a rental's evidence: set on a document filed with
 * anything else it would be a label nothing reads. 400
 * `DOCUMENT_CATEGORY_NOT_RENTAL`, `field: rentalCategory`.
 */
function assertCategoryFits(
  category: RentalDocumentCategory | null | undefined,
  entry: EntryRef | null
): void {
  if (category == null) return;
  if (entry?.type !== "rentalBooking") {
    throw new AppError(
      "A rental category needs a document filed with a rental",
      400,
      "DOCUMENT_CATEGORY_NOT_RENTAL",
      "rentalCategory"
    );
  }
}

/**
 * Changes what the user may change about a kept original: what it is, the date
 * printed on it, and where it is filed. The bytes and everything derived from
 * them (format, sha256, size) are not editable — a different file is a
 * different document.
 */
export async function updateDocument(
  userId: string,
  id: string,
  input: UpdateDocumentInput
): Promise<Document> {
  const document = await getOwnDocument(userId, id);
  if (input.kind && !DOCUMENT_KINDS.includes(input.kind))
    throw new AppError("Unknown document kind", 400);

  if (input.entry) await assertEntryOwned(userId, input.entry);

  return inLinkTransaction(async (tx) => {
    // Decided on the row as it stands under the lock: read before it, a
    // concurrent unfile or refile would be silently undone here.
    if (!(await lockDocument(tx, userId, document.id))) {
      throw new AppError("Document not found", 404);
    }
    const current = entryOf(await tx.document.findUniqueOrThrow({ where: { id: document.id } }));
    const same =
      !!input.entry && current?.type === input.entry.type && current.id === input.entry.id;
    // Moving between entries is an unlink and a link, said explicitly: a
    // document filed elsewhere answers 409, exactly as linking does.
    if (input.entry && !same && current) {
      throw new AppError("Document is already filed with another entry", 409);
    }

    // The entry the document ends up with decides whether a category may
    // stand: taken off its rental (or onto anything else) it loses the label —
    // the link's category follows its target (`setPrimaryLink`).
    const finalEntry = input.entry === undefined ? current : input.entry;
    assertCategoryFits(input.rentalCategory, finalEntry);
    if (input.entry !== undefined || input.rentalCategory !== undefined) {
      await setPrimaryLink(tx, userId, document.id, finalEntry, {
        provenance: "user",
        ...(input.rentalCategory !== undefined && { rentalCategory: input.rentalCategory }),
      });
    }
    return tx.document.update({
      where: { id: document.id },
      data: {
        ...(input.displayName !== undefined && {
          originalName: sanitizeOriginalName(input.displayName),
        }),
        ...(input.note !== undefined && { note: input.note?.trim() ? input.note.trim() : null }),
        ...(input.kind !== undefined && { kind: input.kind }),
        ...(input.issuedOn !== undefined && { issuedOn: input.issuedOn }),
      },
    });
  });
}

export async function getOwnDocument(userId: string, id: string): Promise<Document> {
  const document = await prisma.document.findFirst({ where: { id, userId } });
  if (!document) throw new AppError("Document not found", 404);
  return document;
}

export async function listDocumentsForEntry(userId: string, entry: EntryRef): Promise<Document[]> {
  return (await listEntryDocuments(userId, entry)).map((e) => e.document);
}

export async function deleteDocument(userId: string, id: string): Promise<void> {
  const document = await getOwnDocument(userId, id);
  // A receipt is named by its entry's `receiptUrl`; left behind, the link
  // would show a receipt that answers 404.
  const receiptUrl = `/api/v1/documents/${document.id}/file`;
  await prisma.$transaction([
    // share-exempt: clears a receipt URL — private
    prisma.flight.updateMany({ where: { userId, receiptUrl }, data: { receiptUrl: null } }),
    prisma.lodgingStay.updateMany({ where: { userId, receiptUrl }, data: { receiptUrl: null } }),
    prisma.document.delete({ where: { id: document.id } }),
  ]);
  await releaseDocumentFiles([document.storedName]);
  logger.info(
    { operation: "document_deleted", documentId: document.id, format: document.format },
    "Document deleted"
  );
}

/** Removes the files of rows already deleted — each only once no other row names it. */
export async function removeStoredFiles(storedNames: readonly string[]): Promise<void> {
  await releaseDocumentFiles(storedNames);
}

export interface SweepResult {
  expiredUnfiled: number;
  orphanFiles: number;
}

/**
 * Hourly (jobs/documentSweepScheduler.ts): unfiled uploads past their TTL go, and so does any file with no row
 * (a cascade that removed rows without their bytes, a crash between write and
 * insert). A file younger than an hour is left alone — it may belong to an
 * upload whose row is being written right now.
 */
export async function sweepDocuments(
  now = new Date(),
  fileAgeMs: (name: string) => Promise<number | null> = (name) =>
    uploadFileAgeMs(DOCUMENT_DIR, name, now.getTime())
): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - UNLINKED_TTL_DAYS * 24 * 60 * 60 * 1000);
  const expired = await prisma.document.findMany({
    // `unlinkedAt`, not `createdAt` — see `unfiledDeletesAt`. A null never
    // matches `lt`, which is the safe direction: a row nobody can date is a
    // row nobody deletes, and it is the same abstention the inbox makes.
    where: { ...NO_OWNER, unlinkedAt: { lt: cutoff } },
    select: { id: true, storedName: true },
  });
  const removed = expired.length > 0 ? await deleteStillExpired(expired, cutoff) : [];
  if (removed.length > 0) await removeStoredFiles(removed.map((d) => d.storedName));

  // The orphan half is the generic sweep's (forgejo#287), which every other
  // upload directory runs too; the TTL above is the documents' own. An orphan
  // is quarantined, not deleted — see `services/files/quarantine.ts`.
  const { quarantined: orphanFiles } = await sweepUploadDir("documents", {
    now: now.getTime(),
    fileAgeMs: (_dir, name) => fileAgeMs(name),
  });
  if (removed.length > 0 || orphanFiles > 0) {
    logger.info(
      { operation: "document_sweep", expiredUnfiled: removed.length, orphanFiles },
      "Document sweep removed unfiled uploads and quarantined orphan files"
    );
  }
  return { expiredUnfiled: removed.length, orphanFiles };
}

/**
 * Deletes the candidates that are STILL unlinked and expired, decided under
 * their row locks. The sweep used to select and then delete by id, so a
 * document filed between the two was deleted with the link just made. A link
 * insert holds a key-share lock on the document row: one committed before the
 * lock is seen by the re-check; one attempted after waits and then fails on
 * the missing row instead of vanishing.
 */
async function deleteStillExpired(
  candidates: readonly { id: string; storedName: string }[],
  cutoff: Date
): Promise<{ id: string; storedName: string }[]> {
  const ids = candidates.map((d) => d.id);
  return inLinkTransaction(async (tx) => {
    await lockDocuments(tx, ids);
    const still = await tx.document.findMany({
      where: { id: { in: ids }, ...NO_OWNER, links: { none: {} }, unlinkedAt: { lt: cutoff } },
      select: { id: true, storedName: true },
    });
    if (still.length > 0) {
      await tx.document.deleteMany({ where: { id: { in: still.map((d) => d.id) } } });
    }
    return still;
  });
}

export interface DocumentDto {
  id: string;
  format: string;
  kind: string | null;
  mimetype: string;
  sizeBytes: number;
  sha256: string;
  /** Pages of a PDF, counted at upload; null when unknown (every non-PDF, older rows). */
  pageCount: number | null;
  originalName: string | null;
  /** The owner's own remark; null = none. */
  note: string | null;
  /** What to call it on screen: the client's name, or a generic one with the right extension. */
  displayName: string;
  issuedOn: string | null;
  /** A rental evidence category; null = uncategorised or not a rental's (forgejo#239). */
  rentalCategory: string | null;
  source: string;
  parsedDomain: string | null;
  entry: EntryRef | null;
  createdAt: string;
  linkedAt: string | null;
  url: string;
  /**
   * The values the stored parse reading holds, booking-wide (no leg picked);
   * null when there is no usable reading. Read from `parsedPayload`, never by
   * parsing again (forgejo#132 item 3).
   */
  parsedValues: ExtractedValues | null;
}

/** `toDocumentDto` plus the date the sweep will take it. */
export function toUnfiledDocumentDto(
  document: Document
): DocumentDto & { deletesAt: string | null } {
  return {
    ...toDocumentDto(document),
    deletesAt: unfiledDeletesAt(document)?.toISOString() ?? null,
  };
}

export function toDocumentDto(document: Document): DocumentDto {
  return {
    id: document.id,
    format: document.format,
    kind: document.kind,
    mimetype: document.mimetype,
    sizeBytes: document.sizeBytes,
    sha256: document.sha256,
    pageCount: document.pageCount,
    originalName: document.originalName,
    note: document.note,
    displayName: document.originalName ?? `document${path.extname(document.storedName)}`,
    issuedOn: document.issuedOn ? document.issuedOn.toISOString().slice(0, 10) : null,
    rentalCategory: document.rentalCategory,
    source: document.source,
    parsedDomain: document.parsedDomain,
    entry: entryOf(document),
    createdAt: document.createdAt.toISOString(),
    linkedAt: document.linkedAt ? document.linkedAt.toISOString() : null,
    url: `/api/v1/documents/${document.id}/file`,
    parsedValues: storedReading(document).values,
  };
}
