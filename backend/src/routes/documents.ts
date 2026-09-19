import fs from "fs";
import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { z } from "zod";

import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { documentUploadLimiter } from "../middleware/rateLimit";
import { documentUploadFieldsSchema, updateDocumentSchema } from "../schemas/document";
import { DOCUMENT_MAX_BYTES, DOCUMENT_SIZE_LIMITS } from "../services/documents/documentFormats";
import {
  ENTRY_TYPES,
  createDocument,
  deleteDocument,
  getOwnDocument,
  listDocumentsForEntry,
  listUnfiledDocuments,
  toDocumentDto,
  toUnfiledDocumentDto,
  updateDocument,
  type EntryType,
} from "../services/documents/documentService";
import { documentPath } from "../services/documents/documentStore";

/**
 * Kept originals — the HTTP side of forgejo#116. The rules live in
 * `services/documents/documentService.ts`; this file only translates.
 *
 * The shape is the contract the Companion coded against before the server
 * existed (issue comment of 2026-09-16, `app/src/lib/server/documents.ts`):
 *
 *  - `GET /documents/limits` is the capability probe. Its 404 on an older
 *    server is how the app knows to hide the feature, so it must never move.
 *  - `POST /documents` answers 201 for a new document and 200 with the one
 *    already on file for a repeat. Idempotency is by the BYTES (sha256 +
 *    entry), which covers `clientDocumentId`: a retried send carries the same
 *    file. The id is accepted and validated, not stored — a second key that
 *    could disagree with the first would only add a way to be wrong.
 *  - The per-entry lists sit under each entry's own path.
 *
 * Mounted at `/api/v1` because those entry paths span five prefixes, so
 * authentication is per route here and never `router.use` — a router-level
 * guard on `/api/v1` would run for every request that passes through it.
 */
const router = Router();

const uuid = z.string().uuid();

/** Where each entry type's documents are listed. */
const ENTRY_LIST_PATHS: Record<EntryType, string> = {
  flight: "/flights/:id/documents",
  cruise: "/cruises/:id/documents",
  lodgingStay: "/lodging/stays/:id/documents",
  placeVisit: "/places/visits/:id/documents",
  trip: "/trips/:id/documents",
};

const toDate = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00Z`);

const upload = multer({
  storage: multer.memoryStorage(),
  // The largest per-format limit; the per-format check happens once the bytes
  // say what the file is.
  limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 },
});

/** multer's own errors as the statuses a client can act on, instead of a 500. */
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(
        new AppError(`Document too large: at most ${DOCUMENT_MAX_BYTES / (1024 * 1024)} MB.`, 413)
      );
    }
    return next(new AppError(err instanceof Error ? err.message : "Upload failed", 400));
  });
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new AppError(parsed.error.issues.map((i) => i.message).join("; "), 400);
  return parsed.data;
}

router.get("/documents/limits", authenticate, (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: DOCUMENT_SIZE_LIMITS });
});

/**
 * The caller's own unfiled documents, newest first, each carrying the date the
 * hourly sweep will remove it.
 *
 * ABOVE `/documents/:id`, because `unfiled` would otherwise be parsed as an id
 * and refused as a malformed uuid.
 *
 * It exists because the sweep was silent: an upload that was never filed was
 * deleted, row and bytes, after seven days, and no screen and no locale string
 * mentioned it (2026-09-19 integrity audit, finding 4). The TTL is 30 days now,
 * and this is what the inbox reads to say so before the day arrives.
 */
router.get(
  "/documents/unfiled",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const documents = await listUnfiledDocuments(req.userId!);
      res.json({ success: true, data: documents.map(toUnfiledDocumentDto) });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/documents",
  authenticate,
  // ABOVE the limiter and multer, so a refused request writes no bytes at all.
  // Without it the shared demo account — whose password is printed on the login
  // page of a public preview — could upload real boarding passes and invoices,
  // and those survive the nightly reseed: an UNFILED document is kept for
  // `UNLINKED_TTL_DAYS` (7) days, its bytes sit under `uploads/documents/`, and
  // `GET /documents/:id/file` hands them to whoever logs in next. This router
  // arrived from main AFTER the upload guard sweep of 2026-09-17, which is why
  // it was the only upload surface still open (security audit of 2026-09-19,
  // finding 1).
  rejectDemo,
  requireWriteScope,
  documentUploadLimiter,
  handleUpload,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) throw new AppError("No file uploaded (multipart field `file`)", 400);
      const fields = parseOrThrow(documentUploadFieldsSchema, req.body);
      const { document, created } = await createDocument({
        userId: req.userId!,
        buffer: req.file.buffer,
        originalName: fields.displayName ?? req.file.originalname,
        declaredMime: req.file.mimetype,
        declaredFormat: fields.format,
        source: fields.source ?? "upload",
        kind: fields.kind ?? null,
        issuedOn: toDate(fields.issuedOn) ?? null,
        entry:
          fields.entryType && fields.entryId
            ? { type: fields.entryType, id: fields.entryId }
            : null,
      });
      res.status(created ? 201 : 200).json({ success: true, data: toDocumentDto(document) });
    } catch (error) {
      next(error);
    }
  }
);

for (const type of ENTRY_TYPES) {
  router.get(
    ENTRY_LIST_PATHS[type],
    authenticate,
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const id = parseOrThrow(uuid, req.params.id);
        const documents = await listDocumentsForEntry(req.userId!, { type, id });
        res.json({ success: true, data: documents.map(toDocumentDto) });
      } catch (error) {
        next(error);
      }
    }
  );
}

router.get(
  "/documents/:id",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const document = await getOwnDocument(req.userId!, parseOrThrow(uuid, req.params.id));
      res.json({ success: true, data: toDocumentDto(document) });
    } catch (error) {
      next(error);
    }
  }
);

/** Formats a browser should hand to the user rather than render in the app's origin. */
const DOWNLOAD_ONLY = new Set(["eml", "pkpass"]);

router.get(
  "/documents/:id/file",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const document = await getOwnDocument(req.userId!, parseOrThrow(uuid, req.params.id));
      const filePath = documentPath(document.storedName);
      // Checked before any header is set: the error answer must not go out
      // labelled as a PDF.
      if (!fs.existsSync(filePath)) throw new AppError("Document file missing", 404);
      // `private`, overriding the API-wide `no-store`: one user's bill or boarding
      // pass may sit in their own browser cache, never in a shared one.
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.type(document.mimetype);
      if (DOWNLOAD_ONLY.has(document.format)) {
        res.attachment(toDocumentDto(document).displayName);
      }
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/documents/:id",
  authenticate,
  // The same guard `POST /documents` carries, for the same reason and in the
  // same place — above everything that reads the request.
  //
  // It was on the upload alone, and PATCH and DELETE were left to ownership:
  // the shared demo account can own no document, so `updateDocument` and
  // `deleteDocument` would not find one to touch. That is true and it is not
  // a boundary — it holds because of what the data happens to contain, not
  // because of what the route decides, and it stops holding the moment a
  // restored dump, a seed, or a reassignment gives the demo account a
  // document. Beta API audit of 2026-09-19, unlisted finding 4.
  rejectDemo,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseOrThrow(uuid, req.params.id);
      const input = parseOrThrow(updateDocumentSchema, req.body);
      const document = await updateDocument(req.userId!, id, {
        kind: input.kind,
        issuedOn: toDate(input.issuedOn),
        entry: input.entry,
      });
      res.json({ success: true, data: toDocumentDto(document) });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/documents/:id",
  authenticate,
  // As on PATCH above — the guard is the boundary, ownership is not.
  rejectDemo,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await deleteDocument(req.userId!, parseOrThrow(uuid, req.params.id));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
