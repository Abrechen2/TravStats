import crypto from "crypto";
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { getAuthCookieOptions } from "../auth";
import { generateToken } from "../../utils/jwt";
import {
  activateTwoFactorSchema,
  verifyTwoFactorSchema,
  disableTwoFactorSchema,
} from "../../schemas/twoFactor";
import { comparePassword } from "../../utils/password";
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
  consumeRecoveryCode,
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

/**
 * Redeem the login challenge. Deliberately NOT behind `authenticate` — there is
 * no session yet; the `twofa_token` cookie is the credential, and it is good for
 * ONE successful login or MAX_VERIFY_ATTEMPTS failures, whichever comes first.
 */
const MAX_VERIFY_ATTEMPTS = 5;
/** Attempts per challenge hash. In memory: a challenge lives five minutes, and
 *  this instance runs one Node process per container. */
const attemptsByChallenge = new Map<string, number>();

router.post("/verify", authLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payload = verifyTwoFactorSchema.parse(req.body);
    const challenge = req.cookies?.twofa_token;
    if (typeof challenge !== "string" || challenge.length === 0) {
      throw new AppError("No two-factor challenge in progress", 401);
    }

    const hashed = crypto.createHash("sha256").update(challenge).digest("hex");
    const user = await prisma.user.findUnique({ where: { twoFactorToken: hashed } });
    if (!user || !user.twoFactorTokenExpiry || user.twoFactorTokenExpiry < new Date()) {
      throw new AppError("Two-factor challenge expired", 401);
    }
    if (!user.twoFactorSecret) {
      throw new AppError("Two-factor is not enabled for this account", 401);
    }

    const accepted = payload.code
      ? verifyCode(decryptSecret(user.twoFactorSecret), payload.code)
      : await consumeRecoveryCode(user.id, payload.recoveryCode!);

    if (!accepted) {
      // A wrong code costs an attempt but not the whole challenge — a typo must
      // not force the password to be retyped. After MAX_VERIFY_ATTEMPTS the
      // challenge is destroyed, so the five-minute window is not an unlimited
      // guessing budget.
      const attempts = (attemptsByChallenge.get(hashed) ?? 0) + 1;
      attemptsByChallenge.set(hashed, attempts);
      logger.warn({ operation: "two_factor_verify_failed", userId: user.id, attempts });

      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        attemptsByChallenge.delete(hashed);
        await prisma.user.updateMany({
          where: { id: user.id, twoFactorToken: hashed },
          data: { twoFactorToken: null, twoFactorTokenExpiry: null },
        });
      }
      throw new AppError("That code is not right", 401);
    }
    attemptsByChallenge.delete(hashed);

    // Burn the challenge CONDITIONALLY: `updateMany` scoped to the token value
    // means two requests racing on one challenge produce exactly one winner, the
    // same guarantee consumeRecoveryCode relies on. A plain update would let both
    // proceed and mint two sessions from one challenge.
    const burned = await prisma.user.updateMany({
      where: { id: user.id, twoFactorToken: hashed },
      data: { twoFactorToken: null, twoFactorTokenExpiry: null },
    });
    if (burned.count !== 1) throw new AppError("Two-factor challenge expired", 401);
    res.clearCookie("twofa_token", { path: "/" });
    res.cookie("auth_token", generateToken(user.id), getAuthCookieOptions(req));

    logger.info({ operation: "two_factor_verify_ok", userId: user.id });
    res.json({
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (error) {
    next(error);
  }
});

/** Clear everything for the caller. Costs the password, because switching off a
 *  protection is exactly as sensitive as switching it on. */
router.post(
  "/disable",
  authenticate,
  authLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const { password } = disableTwoFactorSchema.parse(req.body);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new AppError("User not found", 404);
      if (!(await comparePassword(password, user.passwordHash))) {
        throw new AppError("Password is incorrect", 401);
      }

      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            twoFactorSecret: null,
            twoFactorPendingSecret: null,
            twoFactorEnabledAt: null,
            twoFactorToken: null,
            twoFactorTokenExpiry: null,
          },
        }),
        prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
      ]);

      logger.info({ operation: "two_factor_disabled", userId });
      res.json({ disabled: true });
    } catch (error) {
      next(error);
    }
  }
);

/** A new sheet of codes — what you do when the old sheet leaked. */
router.post(
  "/recovery-codes",
  authenticate,
  authLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const { password } = disableTwoFactorSchema.parse(req.body);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new AppError("User not found", 404);
      if (!user.twoFactorEnabledAt) {
        throw new AppError("Two-factor authentication is not enabled", 400);
      }
      if (!(await comparePassword(password, user.passwordHash))) {
        throw new AppError("Password is incorrect", 401);
      }

      const recoveryCodes = await generateRecoveryCodes(userId);
      logger.info({ operation: "two_factor_recovery_codes_regenerated", userId });
      res.json({ recoveryCodes });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
