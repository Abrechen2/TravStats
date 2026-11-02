/**
 * `/api/v1/remote-plans` - plans on another server, worked on through the member's own account
 * (spec 2026-11-02 §4). Enveloped (`{success, data}`, ADR 0001). This server proxies every call to
 * the host under the signed channel of the user connection; it holds the invitation and a pointer,
 * never the plan. `SHARE_REMOTE_DISABLED` (404) while federation is off. Errors:
 * `REMOTE_PLAN_NOT_FOUND` 404, `REMOTE_PLAN_NOT_SHARED` 403, `REMOTE_PLAN_UNREACHABLE` 503 (the
 * host is offline: a client keeps its queue and replays the same `clientRef`).
 */
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { planDocumentUpload } from "../middleware/planDocumentUpload";
import {
  REMOTE_READS_PER_MINUTE,
  REMOTE_WRITES_PER_MINUTE,
} from "../services/sharing/federation/plans/shared";
import {
  acceptRemotePlan,
  collabRemotePlan,
  declineRemotePlan,
  exportRemotePlan,
  getRemotePlanDocument,
  leaveRemotePlan,
  listRemotePlanDocuments,
  listRemotePlans,
  mutateRemotePlan,
  putRemotePlanDocument,
  readNoticesRemotePlan,
  readRemotePlan,
} from "../services/sharing/federation/plans/memberApi";

const router = Router();
const uuid = z.string().uuid();
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

const route =
  (fn: (req: AuthRequest, res: Response) => Promise<void>) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

// Per person, not per address: one person cannot spend another's allowance (spec §4 limits).
const personKey = (req: Request): string => `remote-plans:${(req as AuthRequest).userId ?? "none"}`;
const tooMany = (_req: Request, res: Response) => {
  res.status(429).json({ error: "Too many requests", code: "REMOTE_PLAN_RATE_LIMITED" });
};
const limiter = (max: number) =>
  rateLimit({
    windowMs: 60_000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: personKey,
    handler: tooMany,
  });
const writes = limiter(REMOTE_WRITES_PER_MINUTE);
const reads = limiter(REMOTE_READS_PER_MINUTE);
const limits: RequestHandler = (req, res, next) =>
  (SAFE.has(req.method) ? reads : writes)(req, res, next);

router.use(authenticate);
router.use(requireWriteScope);
router.use(rejectDemoWrites);
router.use(limits);

const ids = (req: AuthRequest) => ({
  userId: req.userId!,
  connectionId: uuid.parse(req.params.connectionId),
  planId: uuid.parse(req.params.planId),
});
const ok = (res: Response, data: unknown, status = 200) => {
  res.status(status).json({ success: true, data });
};
const fileUrl = (connectionId: string, planId: string, id: string) =>
  `/api/v1/remote-plans/${connectionId}/${planId}/documents/${id}/file`;

router.get(
  "/",
  route(async (req, res) => {
    ok(res, await listRemotePlans(req.userId!));
  })
);

router.get(
  "/:connectionId/:planId",
  route(async (req, res) => {
    const { userId, connectionId, planId } = ids(req);
    const read = await readRemotePlan(
      userId,
      connectionId,
      planId,
      req.get("If-None-Match") ?? undefined
    );
    res.setHeader("ETag", read.etag);
    if (read.notModified) {
      res.status(304).end();
      return;
    }
    ok(res, read.data);
  })
);

router.post(
  "/:connectionId/:planId/mutations",
  route(async (req, res) => {
    const { userId, connectionId, planId } = ids(req);
    ok(res, await mutateRemotePlan(userId, connectionId, planId, req.body));
  })
);

router.get(
  "/:connectionId/:planId/collab",
  route(async (req, res) => {
    const { userId, connectionId, planId } = ids(req);
    ok(res, await collabRemotePlan(userId, connectionId, planId));
  })
);

router.post(
  "/:connectionId/:planId/notices/read",
  route(async (req, res) => {
    const { userId, connectionId, planId } = ids(req);
    ok(res, await readNoticesRemotePlan(userId, connectionId, planId));
  })
);

router.get(
  "/:connectionId/:planId/documents",
  route(async (req, res) => {
    const { userId, connectionId, planId } = ids(req);
    const listed = (await listRemotePlanDocuments(userId, connectionId, planId)) as {
      documents: { id: string }[];
    };
    ok(res, {
      documents: listed.documents.map((d) => ({ ...d, url: fileUrl(connectionId, planId, d.id) })),
    });
  })
);

router.post(
  "/:connectionId/:planId/documents",
  planDocumentUpload,
  route(async (req, res) => {
    const { userId, connectionId, planId } = ids(req);
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) throw new AppError("No file uploaded (multipart field `file`)", 400);
    const fields = z.object({ bookingId: uuid.optional() }).parse(req.body ?? {});
    const dto = (await putRemotePlanDocument(
      userId,
      connectionId,
      planId,
      file,
      fields.bookingId
    )) as {
      id: string;
    };
    ok(res, { ...dto, url: fileUrl(connectionId, planId, dto.id) }, 201);
  })
);

router.get(
  "/:connectionId/:planId/documents/:documentId/file",
  route(async (req, res) => {
    const { userId, connectionId, planId } = ids(req);
    const file = await getRemotePlanDocument(
      userId,
      connectionId,
      planId,
      uuid.parse(req.params.documentId)
    );
    // The owner's kept original, served from this origin: never rendered as a page.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.type(file.contentType);
    res.attachment(file.filename);
    res.send(file.bytes);
  })
);

router.get(
  "/:connectionId/:planId/export",
  route(async (req, res) => {
    const { userId, connectionId, planId } = ids(req);
    const file = await exportRemotePlan(userId, connectionId, planId);
    res.setHeader("Content-Type", "application/zip");
    res.attachment(file.filename);
    res.send(file.bytes);
  })
);

router.post(
  "/:connectionId/:planId/accept",
  route(async (req, res) => {
    const { userId, connectionId, planId } = ids(req);
    ok(res, await acceptRemotePlan(userId, connectionId, planId));
  })
);

router.post(
  "/:connectionId/:planId/decline",
  route(async (req, res) => {
    const { userId, connectionId, planId } = ids(req);
    await declineRemotePlan(userId, connectionId, planId);
    ok(res, { declined: true });
  })
);

router.post(
  "/:connectionId/:planId/leave",
  route(async (req, res) => {
    const { userId, connectionId, planId } = ids(req);
    await leaveRemotePlan(userId, connectionId, planId);
    ok(res, { left: true });
  })
);

export default router;
