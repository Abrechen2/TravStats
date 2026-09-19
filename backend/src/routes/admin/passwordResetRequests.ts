import { Router, Response, NextFunction } from "express";

import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import {
  listOpenPasswordResetRequests,
  markPasswordResetRequestHandled,
} from "../../services/passwordResetRequestService";
import logger from "../../utils/logger";
import { z } from "../../schemas/zod";

/**
 * The administrator's half of "I forgot my password" on an instance without
 * mail delivery (forgejo#88, point 2).
 *
 * The user's half is the unauthenticated `POST /auth/forgot-password` in
 * `routes/passwordReset.ts`, which writes at most one row per account and
 * answers the same neutral 200 it always has. This router is where that row is
 * read, and it is admin-only by mounting: every route under `routes/admin/` is
 * behind `authenticate` + `requireAdmin` + `requireWriteScope` (see
 * `admin/index.ts`), so there is no per-user view of this list anywhere.
 *
 * Bare response shape, like every other admin router — see
 * `docs/adr/0001-api-response-shape.md` and the ratchet baseline.
 */

const router = Router();

const requestIdParamSchema = z.object({ id: z.string().uuid() });

/** GET /password-reset-requests — the open ones, newest first. */
router.get("/password-reset-requests", async (_req, res: Response, next: NextFunction) => {
  try {
    const requests = await listOpenPasswordResetRequests();
    res.json({ requests, count: requests.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /password-reset-requests/:id/handled — "I have dealt with this."
 *
 * Stamps `handledAt` and nothing else. It deliberately does NOT reset the
 * password: that happens in user management, under the admin's own eyes, with
 * the existing `POST /users/:id/reset-password`. Two buttons because they are
 * two decisions — an admin may well answer a request by telephone and then
 * clear it here.
 */
router.post(
  "/password-reset-requests/:id/handled",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = requestIdParamSchema.parse(req.params);

      const handledAt = await markPasswordResetRequestHandled(id);
      if (!handledAt) {
        throw new AppError("Password reset request not found", 404);
      }

      logger.info({
        operation: "password_reset_request_handled",
        message: "Admin marked a password-reset request as handled",
        context: { requestId: id, adminId: req.userId },
      });

      // The row itself, not an envelope — this is a bare-family router.
      res.json({ id, handledAt: handledAt.toISOString() });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
