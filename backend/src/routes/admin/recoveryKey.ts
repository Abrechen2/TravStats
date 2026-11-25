/**
 * The instance recovery key (backup settings). Mounted on the admin router, so
 * `authenticate` + `requireAdmin` already ran; see
 * `services/backup/recoveryKey.ts` for why the key exists and what each step
 * proves. Bare response family (ADR 0001), like `backupSettings.ts`.
 *
 * The key is only ever read through `POST /recovery-key/reveal` — never a GET,
 * so no cache, prefetch or link preview can fetch it — and the global
 * `Cache-Control: no-store` default for `/api` is left in place.
 */
import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { AuthRequest, requireBrowserSession } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { recoveryKeyLimiter } from "../../middleware/rateLimit";
import { requirePasswordReauth } from "../../services/account/reauthPassword";
import { verifyReauthAssertion } from "../../services/webauthn/reauth";
import {
  confirmRecoveryKey,
  recoveryKeyStatus,
  revealRecoveryKey,
} from "../../services/backup/recoveryKey";

const revealSchema = z
  .object({
    password: z.string().max(1024).optional(),
    code: z.string().max(32).optional(),
    recoveryCode: z.string().max(64).optional(),
    passkeyResponse: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const confirmSchema = z.object({ lastFour: z.string().max(16) }).strict();

const router = Router();

/** GET /api/v1/admin/recovery-key/status — whether the confirmation is owed. Never the key. */
router.get("/recovery-key/status", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await recoveryKeyStatus());
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/admin/recovery-key/reveal — re-authenticate, then the key, once. */
router.post(
  "/recovery-key/reveal",
  requireBrowserSession,
  recoveryKeyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = revealSchema.parse(req.body ?? {});
      const userId = req.userId!;
      if (body.passkeyResponse) {
        // A passkey with user verification proves possession plus a gesture,
        // the same trade the account deletion accepts.
        await verifyReauthAssertion(userId, body.passkeyResponse);
      } else if (body.password) {
        await requirePasswordReauth(userId, body);
      } else {
        throw new AppError(
          "Confirm with your password or a passkey",
          400,
          "RECOVERY_KEY_REAUTH_REQUIRED"
        );
      }
      res.json(await revealRecoveryKey(userId));
    } catch (error) {
      next(error);
    }
  }
);

/** POST /api/v1/admin/recovery-key/confirm — the last four characters, never the key. */
router.post(
  "/recovery-key/confirm",
  requireBrowserSession,
  recoveryKeyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { lastFour } = confirmSchema.parse(req.body ?? {});
      await confirmRecoveryKey(req.userId!, lastFour);
      res.json(await recoveryKeyStatus());
    } catch (error) {
      next(error);
    }
  }
);

export default router;
