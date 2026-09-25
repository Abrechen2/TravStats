import fsp from "fs/promises";

import type { Document, Prisma } from "../../prisma";
import type { Response } from "express";

import { prisma } from "../../db";
import { writeScopeDenial, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { isSharedDemoUser } from "../../utils/sharedDemo";
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
  accepted: readonly DocumentFormat[]
): Promise<{ document: Document; buffer: Buffer }> {
  const document = await getOwnDocument(userId, documentId);
  if (!accepted.includes(document.format as DocumentFormat)) {
    throw new AppError(
      `This route reads ${accepted.join(" or ")}; the document is ${document.format}.`,
      415
    );
  }
  try {
    return { document, buffer: await fsp.readFile(documentPath(document.storedName)) };
  } catch {
    throw new AppError("Document file missing", 404);
  }
}

/**
 * Refuses a read-scoped token that asked a parse to write. Both additions do:
 * `retain` creates a document and `documentId` replaces the reading recorded
 * on one. A plain parse writes nothing and stays open to a read token. Called
 * before the parser runs, so a refusal costs no parser time.
 */
export function assertMayRecord(
  req: AuthRequest,
  asked: { retain?: boolean; documentId?: string }
): void {
  if (!asked.retain && !asked.documentId) return;
  const denial = writeScopeDenial(req);
  if (denial) throw denial;
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
    // Untouched for the shared demo account below: this branch writes the
    // parse's own reading onto a document that already exists and that the
    // route has already proved the caller owns (`readDocumentForParse` →
    // `getOwnDocument`). It persists no new bytes and no new row, so it is not
    // the door.
    await prisma.document.update({ where: { id: args.documentId }, data: parsed });
    return args.documentId;
  }
  if (!args.retain || !args.input) return undefined;

  /**
   * The SHARED demo account keeps nothing. `retain` is IGNORED for it, not
   * refused.
   *
   * `POST /documents` refuses the account outright, but this is the same
   * destination reached through a different door: `createDocument` below writes
   * a `Document` row AND its bytes under `uploads/documents/`, and an UNFILED
   * one — which a parse retention always is — outlives the 04:00 reseed until
   * the wipe catches it, readable in the meantime by the next visitor through
   * `GET /documents/:id/file`. On a public preview whose demo password is
   * printed on the login page, that is a stranger's boarding pass or invoice
   * held on the operator's disk and shown to whoever logs in next.
   *
   * Ignored rather than refused, because the routes themselves must stay open:
   * the template parser is what a visitor came to try, and it costs nothing.
   * `undefined` is the answer this function already gives when retention was
   * not asked for, so the route simply omits `documentId` from its reply — no
   * new error, no new shape, and the parse result is unaffected.
   */
  if (await isSharedDemoUser(args.userId)) return undefined;

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
