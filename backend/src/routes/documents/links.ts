import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import {
  addDocumentLinksSchema,
  assignLinkCompanionSchema,
  entryRefSchema,
  tripCandidatesQuerySchema,
} from "../../schemas/document";
import {
  addLinks,
  listDocumentLinks,
  listLinkCandidates,
  listTripDocumentsFor,
  unlinkFromEntry,
} from "../../services/documents/documentEntryLinks";
import { assignLinkCompanion } from "../../services/documents/documentCompanions";
import { toDocumentDto } from "../../services/documents/documentService";

/**
 * One document, many entries — the HTTP side of plan phase D2
 * (docs/superpowers/specs/2026-11-21-document-links.md). Enveloped family.
 *
 * Mounted BEFORE `routes/documents.ts`, because `/documents/trip-candidates`
 * would otherwise be read as `/documents/:id`.
 */
const router = Router();
const uuid = z.string().uuid();

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new AppError(parsed.error.issues.map((i) => i.message).join("; "), 400);
  return parsed.data;
}

/** The documents of an entry's own trip that it is not linked to yet. */
router.get(
  "/documents/trip-candidates",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const q = parseOrThrow(tripCandidatesQuerySchema, req.query);
      const documents = await listTripDocumentsFor(req.userId!, {
        type: q.entryType,
        id: q.entryId,
      });
      res.json({ success: true, data: documents.map(toDocumentDto) });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/documents/:id/links",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const links = await listDocumentLinks(req.userId!, parseOrThrow(uuid, req.params.id));
      res.json({ success: true, data: links });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/documents/:id/link-candidates",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await listLinkCandidates(req.userId!, parseOrThrow(uuid, req.params.id));
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/documents/:id/links",
  authenticate,
  rejectDemo,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = parseOrThrow(uuid, req.params.id);
      const body = parseOrThrow(addDocumentLinksSchema, req.body);
      await addLinks(
        req.userId!,
        id,
        body.links.map((l) => ({
          entry: l.entry,
          role: l.role,
          provenance: l.provenance,
          rentalCategory: l.rentalCategory,
        }))
      );
      res.status(201).json({ success: true, data: await listDocumentLinks(req.userId!, id) });
    } catch (error) {
      next(error);
    }
  }
);

/** Plan D7: who the document is for at ONE entry (`companionId: null` = me / the whole group). */
router.put(
  "/documents/:id/links/companion",
  authenticate,
  rejectDemo,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = parseOrThrow(uuid, req.params.id);
      const body = parseOrThrow(assignLinkCompanionSchema, req.body);
      res.json({
        success: true,
        data: await assignLinkCompanion(req.userId!, id, body.entry, body.companionId),
      });
    } catch (error) {
      next(error);
    }
  }
);

/** Removes the link to ONE entry (`?entryType=&entryId=`); the document and its other links stay. */
router.delete(
  "/documents/:id/links",
  authenticate,
  rejectDemo,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = parseOrThrow(uuid, req.params.id);
      const entry = parseOrThrow(entryRefSchema, {
        type: req.query.entryType,
        id: req.query.entryId,
      });
      const removed = await unlinkFromEntry(req.userId!, id, entry);
      res.json({ success: true, data: removed });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
