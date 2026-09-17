import fsp from "fs/promises";

import type { Document, Prisma } from "@prisma/client";
import type { Response } from "express";

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { z } from "../../schemas/zod";
import { parseRetentionFields } from "../../schemas/document";
import type { DetectedFormat, DocumentFormat } from "./documentFormats";
import { checkDocumentFormat, createDocument, getOwnDocument } from "./documentService";
import { documentPath } from "./documentStore";

/**
 * The parse routes and kept originals (forgejo#116, step 4).
 *
 * Two additions, both optional, both on every parse route that reads a file:
 *
 *  - `retain: true` keeps the input as a Document (source `parse`, the parse's
 *    domain and payload recorded) and answers its `documentId`. One upload
 *    instead of two.
 *  - `documentId` parses an original that is ALREADY kept instead of bytes in
 *    the body. This is the path for large originals: a 10 MB photograph is
 *    about 13.4 MB as base64 and does not fit the 10 MB JSON body limit, so the
 *    client uploads it once through multipart `POST /documents` and parses it
 *    by id. The parse is recorded on that document.
 *
 * The format and size a retained document would need are checked BEFORE the
 * parse — a refusal after a minute of OCR would waste the minute.
 */

export { parseRetentionFields };

/** Multipart variant: form fields arrive as strings. */
export const multipartRetain = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => value === "true");

/**
 * The bytes of a kept original, for a route that reads only some formats.
 * Another user's document is a 404; a document this route cannot read is a 415
 * naming what it can.
 */
export async function readDocumentForParse(
  userId: string,
  documentId: string,
  accepted: readonly DocumentFormat[],
): Promise<{ document: Document; buffer: Buffer }> {
  const document = await getOwnDocument(userId, documentId);
  if (!accepted.includes(document.format as DocumentFormat)) {
    throw new AppError(`This route reads ${accepted.join(" or ")}; the document is ${document.format}.`, 415);
  }
  try {
    return { document, buffer: await fsp.readFile(documentPath(document.storedName)) };
  } catch {
    throw new AppError("Document file missing", 404);
  }
}

export interface RetainInput {
  buffer: Buffer;
  originalName?: string;
  declaredMime?: string;
  declaredFormat?: DocumentFormat;
  forceFormat?: DetectedFormat;
}

/** Refuses, before any parsing, an input that `retain` could not keep. */
export function assertRetainable(input: RetainInput): void {
  checkDocumentFormat(input);
}

export interface RecordParseInput {
  userId: string;
  /** The document the input was read from, if any. */
  documentId?: string;
  retain?: boolean;
  /** Required when `retain` is set and there is no `documentId`. */
  input?: RetainInput;
  parsedDomain: string;
  parsedPayload: unknown;
}

/**
 * After a parse: record it on the document it came from, or keep the input as a
 * new one. Returns the id to report, or undefined when neither was asked for.
 */
export async function recordParse(args: RecordParseInput): Promise<string | undefined> {
  const parsed = {
    parsedDomain: args.parsedDomain,
    parsedPayload: args.parsedPayload as Prisma.InputJsonValue,
  };
  if (args.documentId) {
    await prisma.document.update({ where: { id: args.documentId }, data: parsed });
    return args.documentId;
  }
  if (!args.retain || !args.input) return undefined;

  const { document, created } = await createDocument({
    userId: args.userId,
    ...args.input,
    source: "parse",
    ...parsed,
  });
  // The same bytes kept earlier are the same document; this parse is the newer reading of it.
  if (!created) await prisma.document.update({ where: { id: document.id }, data: parsed });
  return document.id;
}

/**
 * The parse routes answer errors themselves rather than through the shared
 * handler. This lets them answer a retention AppError with its own status.
 */
export function sendAppError(res: Response, error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  res.status(error.statusCode).json({ error: error.message });
  return true;
}
