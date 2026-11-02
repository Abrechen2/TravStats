/**
 * TravPlan guests, the signed-in side (forgejo#404, spec §6.5): the owner's invitations, the plan
 * documents a local co-planner sees, and the vouch this server signs for one of its own accounts.
 * Bare response family. The guest's own door is `routes/guest.ts`.
 */
import fs from "node:fs";
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { joinLimiter } from "../../middleware/guestAuth";
import { planDocumentUpload } from "../../middleware/planDocumentUpload";
import { origin } from "../../services/federation/envelope";
import { inviteGuest, reissueGuestInvite } from "../../services/travplan/guests/invites";
import { issueVouch, vouchHostCheck } from "../../services/travplan/guests/issue";
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

// Owner: invite a person on a connected server. The answer carries the link, once.
router.post(
  "/trips/:tripId/plan/guests",
  ...write,
  route(async (req, res) => {
    const body = z
      .object({ origin, username: z.string().trim().min(1).max(100) })
      .strict()
      .parse(req.body);
    res.status(201).json(await inviteGuest(req.userId!, trip(req), body));
  })
);

// Owner: a fresh link for a guest who has not joined yet (the old one dies).
router.post(
  "/trips/:tripId/plan/guests/:memberId/invite",
  ...write,
  route(async (req, res) => {
    res
      .status(201)
      .json(await reissueGuestInvite(req.userId!, trip(req), uuid.parse(req.params.memberId)));
  })
);

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

// ---- This server vouches for one of its own accounts (§6.5 step 3) ---------------------------
// Identity is a browser-session act: a personal access token may not sign anyone's name.
const sessionOnly = (req: AuthRequest, _res: Response, next: NextFunction) =>
  next(
    req.apiToken
      ? new AppError("A browser session is required to vouch", 403, "PLAN_GUEST_REQUIRED")
      : undefined
  );

router.get(
  "/federation/vouch/check",
  authenticate,
  sessionOnly,
  joinLimiter,
  route(async (req, res) => {
    const q = z.object({ host: origin }).parse(req.query);
    res.json(await vouchHostCheck(q.host));
  })
);

router.post(
  "/federation/vouch",
  ...write,
  sessionOnly,
  joinLimiter,
  route(async (req, res) => {
    const body = z
      .object({
        host: origin,
        invite: uuid,
        nonce: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(req.body);
    res.json(await issueVouch(req.userId!, body));
  })
);

export default router;
