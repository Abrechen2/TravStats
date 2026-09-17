import path from "path";

import type { Document, Prisma } from "@prisma/client";

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import {
  DOCUMENT_KINDS,
  ENTRY_TYPES,
  detectDocumentFormat,
  type DocumentFormat,
  type EntryType,
  exceededLimit,
  type DetectedFormat,
  type DocumentKind,
} from "./documentFormats";
import {
  documentFileAgeMs,
  listStoredNames,
  newStoredName,
  removeDocumentFile,
  sha256Hex,
  writeDocumentFile,
} from "./documentStore";

/**
 * Kept originals, filed with the entry they produced (forgejo#116).
 *
 * The rules this file holds, each an owner decision of 2026-09-16:
 *
 *  - A document belongs to at most one entry (also a CHECK in the database).
 *  - An upload is IDEMPOTENT per sha256 and target. The Companion queues
 *    originals while offline and flushes them in a burst; a retried send must
 *    return the document it already made, not a second copy.
 *  - Linking works at creation (`documentIds` on the create routes) AND
 *    afterwards, because an offline capture's document can arrive after its
 *    entry.
 *  - Deleting an entry deletes its documents, row and file. The ROWS go with
 *    the entry through the foreign keys; the BYTES go with the hourly sweep,
 *    which is the one place that removes a file whose row is gone. Every path
 *    that can delete an entry — the entry's own route, deleting its lodging
 *    or place, deleting the account, a restore — is covered by that one rule,
 *    where a removal in each route would cover only the routes someone
 *    remembered.
 *  - An upload that is never filed expires (UNLINKED_TTL_DAYS).
 *
 * Logs carry id, format and size — never content, never the file name.
 */

export { ENTRY_TYPES, type EntryType } from "./documentFormats";

export interface EntryRef {
  type: EntryType;
  id: string;
}

const OWNER_COLUMN = {
  flight: "flightId",
  cruise: "cruiseId",
  lodgingStay: "lodgingStayId",
  trip: "tripId",
  placeVisit: "placeVisitId",
} as const satisfies Record<EntryType, keyof Document>;

/**
 * How the row came to be. `parse` is the server's own (a parse route kept its
 * input); a client may say `upload` or `companion`, nothing else.
 */
export const DOCUMENT_SOURCES = ["upload", "companion", "parse"] as const;
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
 * A file with no row younger than this is left alone by the sweep: it may be an
 * upload whose row is being inserted right now.
 */
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;

/** Unfiled uploads older than this are removed by the sweep. */
export const UNLINKED_TTL_DAYS = 7;

const NO_OWNER: Prisma.DocumentWhereInput = {
  flightId: null,
  cruiseId: null,
  lodgingStayId: null,
  tripId: null,
  placeVisitId: null,
};

function ownerWhere(entry: EntryRef): Prisma.DocumentWhereInput {
  return { [OWNER_COLUMN[entry.type]]: entry.id };
}

interface OwnerColumns {
  flightId: string | null;
  cruiseId: string | null;
  lodgingStayId: string | null;
  tripId: string | null;
  placeVisitId: string | null;
  linkedAt: Date | null;
}

function ownerData(entry: EntryRef | null): OwnerColumns {
  return {
    flightId: entry?.type === "flight" ? entry.id : null,
    cruiseId: entry?.type === "cruise" ? entry.id : null,
    lodgingStayId: entry?.type === "lodgingStay" ? entry.id : null,
    tripId: entry?.type === "trip" ? entry.id : null,
    placeVisitId: entry?.type === "placeVisit" ? entry.id : null,
    linkedAt: entry ? new Date() : null,
  };
}

export function entryOf(document: Document): EntryRef | null {
  for (const type of ENTRY_TYPES) {
    const id = document[OWNER_COLUMN[type]];
    if (id) return { type, id };
  }
  return null;
}

/** 404 unless the entry exists AND belongs to the user — a stranger's entry is not an entry. */
export async function assertEntryOwned(userId: string, entry: EntryRef): Promise<void> {
  const where = { id: entry.id, userId };
  const select = { id: true } as const;
  const found =
    entry.type === "flight"
      ? await prisma.flight.findFirst({ where, select })
      : entry.type === "cruise"
        ? await prisma.cruise.findFirst({ where, select })
        : entry.type === "lodgingStay"
          ? await prisma.lodgingStay.findFirst({ where, select })
          : entry.type === "trip"
            ? await prisma.trip.findFirst({ where, select })
            : await prisma.placeVisit.findFirst({ where, select });
  if (!found) throw new AppError("Entry not found", 404);
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

export async function createDocument(input: CreateDocumentInput): Promise<CreateDocumentResult> {
  const hintMime = input.declaredFormat ? FORMAT_HINT_MIME[input.declaredFormat] : undefined;
  const detected =
    input.forceFormat ?? detectDocumentFormat(input.buffer, input.originalName, hintMime ?? input.declaredMime);
  if (detected && input.declaredFormat && detected.format !== input.declaredFormat) {
    throw new AppError(`Document declared as ${input.declaredFormat} but its content is ${detected.format}.`, 415);
  }
  if (!detected) {
    throw new AppError(
      "Unsupported document. Accepted: JPEG, PNG, WebP or HEIC images, PDF, .eml mail files, plain text, Wallet passes (.pkpass).",
      415,
    );
  }
  const limit = exceededLimit(detected.format, input.buffer.length);
  if (limit !== null) {
    throw new AppError(`Document too large: ${detected.format} may be at most ${limit / (1024 * 1024)} MB.`, 413);
  }
  if (input.kind && !DOCUMENT_KINDS.includes(input.kind)) throw new AppError("Unknown document kind", 400);

  const entry = input.entry ?? null;
  if (entry) await assertEntryOwned(input.userId, entry);

  const sha256 = sha256Hex(input.buffer);

  // Idempotency: the same bytes for the same target are the same document.
  const sameTarget = await prisma.document.findFirst({
    where: { userId: input.userId, sha256, ...(entry ? ownerWhere(entry) : NO_OWNER) },
  });
  if (sameTarget) return { document: sameTarget, created: false };

  // A retried offline send may arrive with a target after the first attempt
  // went up unfiled: file that one rather than keeping two copies.
  if (entry) {
    const unfiled = await prisma.document.findFirst({ where: { userId: input.userId, sha256, ...NO_OWNER } });
    if (unfiled) {
      const document = await prisma.document.update({ where: { id: unfiled.id }, data: ownerData(entry) });
      return { document, created: false };
    }
  }

  const storedName = newStoredName(detected.extension);
  await writeDocumentFile(storedName, input.buffer);
  try {
    const document = await prisma.document.create({
      data: {
        userId: input.userId,
        storedName,
        originalName: sanitizeOriginalName(input.originalName),
        mimetype: detected.mimetype,
        sizeBytes: input.buffer.length,
        sha256,
        format: detected.format,
        kind: input.kind ?? null,
        issuedOn: input.issuedOn ?? null,
        source: input.source ?? "upload",
        parsedDomain: input.parsedDomain ?? null,
        ...(input.parsedPayload != null && { parsedPayload: input.parsedPayload }),
        ...ownerData(entry),
      },
    });
    logger.info(
      { operation: "document_created", documentId: document.id, format: document.format, sizeBytes: document.sizeBytes },
      "Document kept",
    );
    return { document, created: true };
  } catch (error) {
    await removeDocumentFile(storedName);
    throw error;
  }
}

/**
 * Checks that every id is the user's and can be filed with `entry` — unfiled,
 * or already filed there. Run BEFORE an entry is created, so a bad id fails the
 * create instead of leaving an entry whose documents never attached.
 */
export async function assertLinkable(userId: string, ids: readonly string[], entry?: EntryRef): Promise<void> {
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

/** Files documents with an entry. Idempotent: already filed there is fine. */
export async function linkDocuments(userId: string, ids: readonly string[], entry: EntryRef): Promise<Document[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  await assertEntryOwned(userId, entry);
  await assertLinkable(userId, unique, entry);
  await prisma.document.updateMany({
    where: { id: { in: unique }, userId, ...NO_OWNER },
    data: ownerData(entry),
  });
  return prisma.document.findMany({ where: { id: { in: unique }, userId }, orderBy: { createdAt: "asc" } });
}

/** Takes a document off its entry; it becomes unfiled and expires unless filed again. */
export async function unlinkDocument(userId: string, id: string): Promise<Document> {
  const document = await getOwnDocument(userId, id);
  return prisma.document.update({ where: { id: document.id }, data: ownerData(null) });
}

export interface UpdateDocumentInput {
  kind?: DocumentKind | null;
  issuedOn?: Date | null;
  /** An entry files it there; null takes it off its entry; absent leaves it. */
  entry?: EntryRef | null;
}

/**
 * Changes what the user may change about a kept original: what it is, the date
 * printed on it, and where it is filed. The bytes and everything derived from
 * them (format, sha256, size) are not editable — a different file is a
 * different document.
 */
export async function updateDocument(userId: string, id: string, input: UpdateDocumentInput): Promise<Document> {
  const document = await getOwnDocument(userId, id);
  if (input.kind && !DOCUMENT_KINDS.includes(input.kind)) throw new AppError("Unknown document kind", 400);

  let owner: Partial<OwnerColumns> = {};
  if (input.entry === null) {
    owner = ownerData(null);
  } else if (input.entry) {
    const current = entryOf(document);
    const same = current?.type === input.entry.type && current.id === input.entry.id;
    if (!same) {
      await assertEntryOwned(userId, input.entry);
      // Moving between entries is an unlink and a link, said explicitly: a
      // document filed elsewhere answers 409, exactly as linking does.
      if (current) throw new AppError("Document is already filed with another entry", 409);
      owner = ownerData(input.entry);
    }
  }

  return prisma.document.update({
    where: { id: document.id },
    data: {
      ...(input.kind !== undefined && { kind: input.kind }),
      ...(input.issuedOn !== undefined && { issuedOn: input.issuedOn }),
      ...owner,
    },
  });
}

export async function getOwnDocument(userId: string, id: string): Promise<Document> {
  const document = await prisma.document.findFirst({ where: { id, userId } });
  if (!document) throw new AppError("Document not found", 404);
  return document;
}

export async function listDocumentsForEntry(userId: string, entry: EntryRef): Promise<Document[]> {
  await assertEntryOwned(userId, entry);
  return prisma.document.findMany({
    where: { userId, ...ownerWhere(entry) },
    orderBy: { createdAt: "asc" },
  });
}

export async function deleteDocument(userId: string, id: string): Promise<void> {
  const document = await getOwnDocument(userId, id);
  await prisma.document.delete({ where: { id: document.id } });
  await removeDocumentFile(document.storedName);
  logger.info({ operation: "document_deleted", documentId: document.id, format: document.format }, "Document deleted");
}

/**
 * The stored files of documents about to disappear with their entries. The
 * foreign keys cascade the ROWS; the bytes need this. Call before the delete,
 * remove after it succeeds — so a failed delete never loses a file.
 */
export async function storedNamesFor(where: Prisma.DocumentWhereInput): Promise<string[]> {
  const rows = await prisma.document.findMany({ where, select: { storedName: true } });
  return rows.map((r) => r.storedName);
}

export async function removeStoredFiles(storedNames: readonly string[]): Promise<void> {
  for (const name of storedNames) await removeDocumentFile(name);
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
  fileAgeMs: (name: string) => Promise<number | null> = (name) => documentFileAgeMs(name, now.getTime()),
): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - UNLINKED_TTL_DAYS * 24 * 60 * 60 * 1000);
  const expired = await prisma.document.findMany({
    where: { ...NO_OWNER, createdAt: { lt: cutoff } },
    select: { id: true, storedName: true },
  });
  if (expired.length > 0) {
    await prisma.document.deleteMany({ where: { id: { in: expired.map((d) => d.id) } } });
    await removeStoredFiles(expired.map((d) => d.storedName));
  }

  const onDisk = await listStoredNames();
  const known = new Set(
    (await prisma.document.findMany({ where: { storedName: { in: onDisk } }, select: { storedName: true } })).map(
      (d) => d.storedName,
    ),
  );
  let orphanFiles = 0;
  for (const name of onDisk) {
    if (known.has(name)) continue;
    // No age means the file vanished between the listing and now: nothing to remove.
    const age = await fileAgeMs(name);
    if (age === null || age < ORPHAN_GRACE_MS) continue;
    await removeDocumentFile(name);
    orphanFiles++;
  }

  if (expired.length > 0 || orphanFiles > 0) {
    logger.info(
      { operation: "document_sweep", expiredUnfiled: expired.length, orphanFiles },
      "Document sweep removed unfiled uploads and orphan files",
    );
  }
  return { expiredUnfiled: expired.length, orphanFiles };
}

export interface DocumentDto {
  id: string;
  format: string;
  kind: string | null;
  mimetype: string;
  sizeBytes: number;
  sha256: string;
  originalName: string | null;
  /** What to call it on screen: the client's name, or a generic one with the right extension. */
  displayName: string;
  issuedOn: string | null;
  source: string;
  parsedDomain: string | null;
  entry: EntryRef | null;
  createdAt: string;
  linkedAt: string | null;
  url: string;
}

export function toDocumentDto(document: Document): DocumentDto {
  return {
    id: document.id,
    format: document.format,
    kind: document.kind,
    mimetype: document.mimetype,
    sizeBytes: document.sizeBytes,
    sha256: document.sha256,
    originalName: document.originalName,
    displayName: document.originalName ?? `document${path.extname(document.storedName)}`,
    issuedOn: document.issuedOn ? document.issuedOn.toISOString().slice(0, 10) : null,
    source: document.source,
    parsedDomain: document.parsedDomain,
    entry: entryOf(document),
    createdAt: document.createdAt.toISOString(),
    linkedAt: document.linkedAt ? document.linkedAt.toISOString() : null,
    url: `/api/v1/documents/${document.id}/file`,
  };
}
