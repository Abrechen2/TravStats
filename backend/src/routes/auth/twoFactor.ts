import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { activateTwoFactorSchema } from "../../schemas/twoFactor";
import {
  generateSecret,
  buildOtpauthUrl,
  encryptSecret,
  decryptSecret,
  verifyCode,
} from "../../services/twoFactor/totpService";
import {
  generateRecoveryCodes,
  countUnusedRecoveryCodes,
} from "../../services/twoFactor/recoveryCodeService";
import logger from "../../utils/logger";

const router = Router();

const ISSUER = "TravStats";

router.get("/status", authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabledAt: true },
    });
    const enabled = Boolean(user?.twoFactorEnabledAt);
    res.json({
      enabled,
      recoveryCodesLeft: enabled ? await countUnusedRecoveryCodes(userId) : 0,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Begin setup. The secret is returned once so the page can render a QR code and
 * offer it for manual entry, and stored as PENDING — not active — so an
 * abandoned setup leaves the account exactly as it was.
 */
router.post(
  "/setup",
  authenticate,
  authLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, twoFactorEnabledAt: true },
      });
      if (!user) throw new AppError("User not found", 404);
      if (user.twoFactorEnabledAt) {
        throw new AppError("Two-factor authentication is already enabled", 409);
      }

      const secret = generateSecret();
      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorPendingSecret: encryptSecret(secret) },
      });

      // Deliberately no secret in the log line.
      logger.info({ operation: "two_factor_setup_started", userId });
      res.json({ secret, otpauthUrl: buildOtpauthUrl(secret, user.username, ISSUER) });
    } catch (error) {
      next(error);
    }
  }
);

/** Confirm the app is configured by proving one code, then switch it on. */
router.post(
  "/activate",
  authenticate,
  authLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const { code } = activateTwoFactorSchema.parse(req.body);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorPendingSecret: true, twoFactorEnabledAt: true },
      });
      if (!user?.twoFactorPendingSecret) {
        throw new AppError("No two-factor setup in progress", 400);
      }
      if (user.twoFactorEnabledAt) {
        throw new AppError("Two-factor authentication is already enabled", 409);
      }

      const secret = decryptSecret(user.twoFactorPendingSecret);
      if (!verifyCode(secret, code)) {
        throw new AppError("That code is not right", 400);
      }

      // Recovery codes FIRST, then the switch. If code generation fails, the
      // account stays exactly as it was — 2FA on with no way back in would be
      // the one outcome this feature must never produce.
      const recoveryCodes = await generateRecoveryCodes(userId);

      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorSecret: user.twoFactorPendingSecret,
          twoFactorPendingSecret: null,
          twoFactorEnabledAt: new Date(),
        },
      });
      logger.info({ operation: "two_factor_enabled", userId });
      res.json({ recoveryCodes });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
