import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { statsLimiter } from "../middleware/rateLimit";
import { ensureDocumentLinkPass } from "../services/documents/linkSuggestions/pass";
import {
  acceptDocumentSuggestions,
  dismissDocumentSuggestions,
  listDocumentSuggestions,
} from "../services/documents/linkSuggestions/store";

/**
 * `/api/v1/document-link-suggestions` — "Dieses Dokument belegt auch …" in the
 * Posteingang (plan D4, docs/superpowers/specs/2026-11-21-document-links.md).
 *
 * Own documents and own entries only: every query below carries the caller's
 * `userId`, so a member of a shared trip sees no proposal and no file name.
 * Nothing is linked until the user accepts. Enveloped.
 *
 * Reading the list or the count starts the scan of stored documents as a job
 * when one is due (the first time for an account, later only for documents
 * created or filed since); the answer carries `pass.jobId` for the client to
 * poll at `GET /jobs/:id`.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const idsBody = z
  .object({ suggestionIds: z.array(z.string().uuid()).min(1).max(200).optional() })
  .strict();

async function passView(userId: string): Promise<{ jobId: string | null }> {
  const job = await ensureDocumentLinkPass(userId);
  return { jobId: job?.id ?? null };
}

router.get(
  "/",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const pass = await passView(req.userId!);
      const suggestions = await listDocumentSuggestions(req.userId!);
      res.json({ success: true, data: { suggestions, total: suggestions.length, pass } });
    } catch (err) {
      next(err);
    }
  }
);

/** The inbox badge's number: documents with something to decide. */
router.get("/count", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const pass = await passView(req.userId!);
    const suggestions = await listDocumentSuggestions(req.userId!);
    res.json({ success: true, data: { count: suggestions.length, pass } });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:documentId/accept",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = idsBody.parse(req.body ?? {});
      const documentId = z.string().uuid().parse(req.params.documentId);
      const result = await acceptDocumentSuggestions(req.userId!, documentId, body.suggestionIds);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:documentId/dismiss",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = idsBody.parse(req.body ?? {});
      const documentId = z.string().uuid().parse(req.params.documentId);
      const dismissed = await dismissDocumentSuggestions(
        req.userId!,
        documentId,
        body.suggestionIds
      );
      res.json({ success: true, data: { dismissed } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
