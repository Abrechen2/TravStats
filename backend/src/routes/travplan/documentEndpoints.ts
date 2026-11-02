/**
 * TravPlan documents for the members on this server (forgejo#404, spec §6.8, D6): what a local
 * co-planner sees and may add. A member on another server reaches the same documents through
 * `routes/remotePlans.ts`. Bare response family.
 */
import fs from "node:fs";
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { planDocumentUpload } from "../../middleware/planDocumentUpload";
import {
  listPlanDocuments,
  readPlanDocument,
  uploadPlanDocument,
} from "../../services/travplan/planDocuments";
import { documentPath } from "../../services/documents/documentStore";

const router = Router();
const uuid = z.string().uuid();
const route =
  (fn: (req: AuthRequest, res: Response) => Promise<void>) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
const write = [authenticate, requireWriteScope, rejectDemo] as const;
const trip = (req: AuthRequest) => uuid.parse(req.params.tripId);

// ---- Plan documents for members on this server (D6) ------------------------------------------
const fileUrl = (tripId: string, id: string) => `/api/v1/trips/${tripId}/plan/documents/${id}/file`;

router.get(
  "/trips/:tripId/plan/documents",
  authenticate,
  route(async (req, res) => {
    const documents = await listPlanDocuments(req.userId!, trip(req));
    res.json({ documents: documents.map((d) => ({ ...d, url: fileUrl(trip(req), d.id) })) });
  })
);

router.post(
  "/trips/:tripId/plan/documents",
  ...write,
  planDocumentUpload,
  route(async (req, res) => {
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) throw new AppError("No file uploaded (multipart field `file`)", 400);
    const fields = z.object({ bookingId: uuid.optional() }).parse(req.body ?? {});
    const dto = await uploadPlanDocument(req.userId!, trip(req), file, fields.bookingId);
    res.status(201).json({ ...dto, url: fileUrl(trip(req), dto.id) });
  })
);

router.get(
  "/trips/:tripId/plan/documents/:documentId/file",
  authenticate,
  route(async (req, res) => {
    const doc = await readPlanDocument(req.userId!, trip(req), uuid.parse(req.params.documentId));
    const filePath = documentPath(doc.storedName);
    if (!fs.existsSync(filePath))
      throw new AppError("Document file missing", 404, "PLAN_DOCUMENT_NOT_FOUND");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.type(doc.mimetype);
    res.attachment(doc.originalName ?? "document");
    res.sendFile(filePath);
  })
);

export default router;
