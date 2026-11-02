import { Router, type NextFunction, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { requireTripFederation } from "../services/sharing/federation/access";
import {
  acceptConnection,
  declineConnection,
  endConnection,
  requestConnection,
  updateConnectionSwitches,
} from "../services/sharing/federation/connections/actions";
import { listConnections } from "../services/sharing/federation/connections/view";
import {
  connectionAcceptBodySchema,
  connectionIdSchema,
  connectionRequestBodySchema,
  connectionSwitchesBodySchema,
} from "../schemas/sharingConnections";

/**
 * `/api/v1/sharing/connections` — user connections across servers (spec 2026-11-02 §5): ask a
 * person on a connected server, confirm or decline a request with the switches chosen, change what
 * is shared, end it. Enveloped like `/sharing` (ADR 0001). Everything refuses with
 * `SHARE_REMOTE_DISABLED` (404) while cross-server sharing is off. A request never says whether
 * the person exists or is findable.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);
router.use(rejectDemoWrites);

/** Requests make this server contact another one, and the answer hides who exists: 30 an hour. */
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many connection requests, please try again later", code: "RATE_LIMITED" },
  keyGenerator: (req: Request): string => {
    const userId = (req as { userId?: string }).userId;
    if (userId) return `share-connect:${userId}`;
    return `share-connect-ip:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;
  },
});

/** The other actions send one message each: the same budget as an invitation. */
const actionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later", code: "RATE_LIMITED" },
  keyGenerator: (req: Request): string => {
    const userId = (req as { userId?: string }).userId;
    if (userId) return `share-connect-act:${userId}`;
    return `share-connect-act-ip:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;
  },
});

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle =
  (fn: Handler) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await requireTripFederation(req.userId!);
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

router.get(
  "/",
  handle(async (req, res) => {
    res.json({ success: true, data: await listConnections(req.userId!) });
  })
);

router.post(
  "/",
  requestLimiter,
  handle(async (req, res) => {
    const body = connectionRequestBodySchema.parse(req.body ?? {});
    res.status(201).json({ success: true, data: await requestConnection(req.userId!, body) });
  })
);

router.post(
  "/:id/accept",
  actionLimiter,
  handle(async (req, res) => {
    const id = connectionIdSchema.parse(req.params.id);
    const { switches } = connectionAcceptBodySchema.parse(req.body ?? {});
    res.json({ success: true, data: await acceptConnection(req.userId!, id, switches) });
  })
);

router.post(
  "/:id/decline",
  actionLimiter,
  handle(async (req, res) => {
    const id = connectionIdSchema.parse(req.params.id);
    res.json({ success: true, data: await declineConnection(req.userId!, id) });
  })
);

router.put(
  "/:id/switches",
  actionLimiter,
  handle(async (req, res) => {
    const id = connectionIdSchema.parse(req.params.id);
    const { switches } = connectionSwitchesBodySchema.parse(req.body ?? {});
    res.json({ success: true, data: await updateConnectionSwitches(req.userId!, id, switches) });
  })
);

router.delete(
  "/:id",
  actionLimiter,
  handle(async (req, res) => {
    const id = connectionIdSchema.parse(req.params.id);
    res.json({ success: true, data: await endConnection(req.userId!, id) });
  })
);

export default router;
