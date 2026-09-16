import type { Document, Prisma } from "@prisma/client";

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import {
  DOCUMENT_KINDS,
  detectDocumentFormat,
  exceededLimit,
  type DetectedFormat,
  type DocumentKind,
} from "./documentFormats";
import {
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
 *  - Deleting an entry deletes its documents, row and file.
 *  - An upload that is never filed expires (UNLINKED_TTL_DAYS).
 *
 * Logs carry id, format and size — never content, never the file name.
 */

export const ENTRY_TYPES = ["flight", "cruise", "lodgingStay", "trip", "placeVisit"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

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

/** Unfiled uploads older than this are removed by the nightly sweep. */
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
  source?: "upload" | "parse";
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
  const detected = input.forceFormat ?? detectDocumentFormat(input.buffer, input.originalName, input.declaredMime);
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
 * Nightly: unfiled uploads past their TTL go, and so does any file with no row
 * (a cascade that removed rows without their bytes, a crash between write and
 * insert). A file younger than an hour is left alone — it may belong to an
 * upload whose row is being written right now.
 */
export async function sweepDocuments(now = new Date(), fileAgeMs?: (name: string) => Promise<number | null>): Promise<SweepResult> {
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
    const age = fileAgeMs ? await fileAgeMs(name) : null;
    if (age !== null && age < 60 * 60 * 1000) continue;
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
    issuedOn: document.issuedOn ? document.issuedOn.toISOString().slice(0, 10) : null,
    source: document.source,
    parsedDomain: document.parsedDomain,
    entry: entryOf(document),
    createdAt: document.createdAt.toISOString(),
    linkedAt: document.linkedAt ? document.linkedAt.toISOString() : null,
    url: `/api/v1/documents/${document.id}/file`,
  };
}
