import { Router, type NextFunction, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import {
  friendAcceptBodySchema,
  friendCreateBodySchema,
  friendKeySchema,
  friendScopeBodySchema,
  friendSwitchesBodySchema,
} from "../schemas/friends";
import { listFriends } from "../services/friends/view";
import {
  acceptFriend,
  createFriend,
  declineFriend,
  removeFriend,
  setFriendScope,
  setFriendSwitches,
} from "../services/friends/actions";
import { friendPlans, friendTrips } from "../services/friends/pairs";

/**
 * `/api/v1/friends` (spec 2026-11-08 §11.4): a friend is one connection, local or remote.
 * Enveloped (ADR 0001). Browser clients; the Companion keeps `/sharing/connections`. A request
 * never says whether the person exists.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);
router.use(rejectDemoWrites);

const limiter = (name: string, max: number) =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later", code: "RATE_LIMITED" },
    keyGenerator: (req: Request): string => {
      const userId = (req as { userId?: string }).userId;
      return userId
        ? `friends-${name}:${userId}`
        : `friends-${name}-ip:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;
    },
  });
/** Asking contacts people and hides who exists: 30 an hour. */
const requestLimiter = limiter("request", 30);
const actionLimiter = limiter("action", 240);

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle =
  (fn: Handler) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
const send = (res: Response, data: unknown, status = 200): void => {
  res.status(status).json({ success: true, data });
};
const keyOf = (req: Request): string => friendKeySchema.parse(req.params.key);

router.get(
  "/",
  handle(async (req, res) => send(res, await listFriends(req.userId!)))
);
router.post(
  "/",
  requestLimiter,
  handle(async (req, res) => {
    const body = friendCreateBodySchema.parse(req.body ?? {});
    send(res, await createFriend(req.userId!, body), 201);
  })
);
router.post(
  "/:key/accept",
  actionLimiter,
  handle(async (req, res) => {
    const { switches } = friendAcceptBodySchema.parse(req.body ?? {});
    send(res, await acceptFriend(req.userId!, keyOf(req), switches));
  })
);
router.post(
  "/:key/decline",
  actionLimiter,
  handle(async (req, res) => send(res, await declineFriend(req.userId!, keyOf(req))))
);
router.put(
  "/:key/switches",
  actionLimiter,
  handle(async (req, res) => {
    const { switches } = friendSwitchesBodySchema.parse(req.body ?? {});
    send(res, await setFriendSwitches(req.userId!, keyOf(req), switches));
  })
);
router.put(
  "/:key/scope",
  actionLimiter,
  handle(async (req, res) => {
    const { scope } = friendScopeBodySchema.parse(req.body ?? {});
    send(res, await setFriendScope(req.userId!, keyOf(req), scope));
  })
);
router.delete(
  "/:key",
  actionLimiter,
  handle(async (req, res) => send(res, await removeFriend(req.userId!, keyOf(req))))
);
router.get(
  "/:key/trips",
  actionLimiter,
  handle(async (req, res) => send(res, await friendTrips(req.userId!, keyOf(req))))
);
router.get(
  "/:key/plans",
  actionLimiter,
  handle(async (req, res) => send(res, { plans: await friendPlans(req.userId!, keyOf(req)) }))
);

export default router;
