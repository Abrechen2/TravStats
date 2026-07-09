import { Router, Response, NextFunction } from "express";

import { authenticate, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { pairingClaimLimiter } from "../middleware/rateLimit";
import { prisma } from "../db";
import { claimPairingSchema, statusPairingSchema } from "../schemas/pairing";
import {
  generatePairingCode,
  getPairingStatus,
  verifyAndConsume,
} from "../services/pairing/pairingService";
import { getPublicBaseUrl } from "../services/instanceSettingsService";
import { generateApiToken } from "../utils/apiTokens";
import { securityLogger } from "../utils/logger";

/**
 * Device-pairing routes, mounted at /api/v1/pairing.
 *
 * Flow:
 *   1. Browser (cookie session) POSTs /start → gets a one-time code + the
 *      public base URL to show as a QR.
 *   2. Mobile app POSTs /claim with the code → exchanges it for a device PAT.
 *   3. Browser polls POST /status (code in the body) to learn when the phone
 *      has paired. The code travels in the body — not the URL — so it never
 *      lands in the HTTP access log.
 *   4. App POSTs /unpair (Bearer) to self-revoke its token.
 *
 * Auth posture per route is deliberately mixed, so `authenticate` is applied
 * per-route rather than router-wide:
 *   - /start, /status  → cookie-only (a PAT must not mint pairing codes, same
 *     PAT-cannot-escalate defence as the token-management routes).
 *   - /claim           → public + rate-limited (the app has no creds yet).
 *   - /unpair          → Bearer-only (acts on the calling token).
 */

const router = Router();

/**
 * Reject PAT-authenticated requests. Pairing-code issuance is a browser-only
 * surface — a PAT minting pairing codes would be a privilege-escalation path
 * (mint code → claim → mint a fresh write PAT), so we hard-403 it.
 */
const cookieOnly = (req: AuthRequest, _res: Response, next: NextFunction): void => {
  if (req.apiToken) {
    securityLogger.warn({
      operation: "security_event",
      message: "PAT-authenticated request attempted device pairing",
      context: {
        eventType: "pat_pairing_blocked",
        tokenId: req.apiToken.id,
        userId: req.userId,
        url: req.url,
      },
    });
    next(new AppError("Device pairing requires a browser session, not an API token", 403));
    return;
  }
  next();
};

// POST /start — issue a one-time pairing code (cookie session only).
router.post(
  "/start",
  authenticate,
  cookieOnly,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) throw new AppError("Unauthorized", 401);
      const { code, expiresAt } = await generatePairingCode(req.userId);
      const publicUrl = await getPublicBaseUrl(req);
      res.json({ code, publicUrl, expiresAt: expiresAt.toISOString() });
    } catch (err) {
      next(err);
    }
  },
);

// POST /status — poll whether the code has been claimed (cookie only). The
// code rides in the body so it never appears in the HTTP access-log URL.
router.post(
  "/status",
  authenticate,
  cookieOnly,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) throw new AppError("Unauthorized", 401);
      const parsed = statusPairingSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.issues[0]?.message ?? "Invalid input", 400);
      }
      const status = await getPairingStatus(parsed.data.code, req.userId);
      res.json({
        claimed: status.claimed,
        ...(status.deviceName ? { deviceName: status.deviceName } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /claim — exchange a pairing code for a device PAT (public, rate-limited).
router.post(
  "/claim",
  pairingClaimLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = claimPairingSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.issues[0]?.message ?? "Invalid input", 400);
      }
      const { code, deviceName, deviceId, platform, appVersion } = parsed.data;

      const userId = await verifyAndConsume(code);
      if (!userId) {
        securityLogger.warn({
          operation: "security_event",
          message: "Pairing claim rejected: invalid or expired code",
          context: { eventType: "pairing_claim_rejected", ip: req.ip, url: req.url },
        });
        throw new AppError("Invalid or expired pairing code", 400);
      }

      // Re-pairing the same physical device revokes its prior token so we don't
      // leave orphaned credentials behind.
      if (deviceId) {
        await prisma.apiToken.updateMany({
          where: { userId, deviceId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      const generated = await generateApiToken();
      const token = await prisma.apiToken.create({
        data: {
          userId,
          label: deviceName || "Gerät",
          scope: "write",
          lookupHash: generated.lookupHash,
          hash: generated.hash,
          ...(deviceId !== undefined && { deviceId }),
          ...(platform !== undefined && { platform }),
          ...(appVersion !== undefined && { appVersion }),
        },
      });

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });

      securityLogger.info({
        operation: "security_event",
        message: "Device paired",
        context: {
          eventType: "device_paired",
          tokenId: token.id,
          userId,
          deviceId: deviceId ?? null,
          platform: platform ?? null,
          ip: req.ip,
        },
      });

      // The app keeps the URL it scanned; returning a server URL here would be
      // a Host-spoofable field it ignores, so we omit it.
      res.status(201).json({
        token: generated.plaintext,
        user: { username: user?.username ?? null },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /unpair — self-revoke the calling device token (Bearer only).
router.post(
  "/unpair",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.apiToken) {
        throw new AppError("Unpair requires an API token", 400);
      }
      await prisma.apiToken.update({
        where: { id: req.apiToken.id },
        data: { revokedAt: new Date() },
      });
      securityLogger.info({
        operation: "security_event",
        message: "Device unpaired",
        context: {
          eventType: "device_unpaired",
          tokenId: req.apiToken.id,
          userId: req.userId,
          ip: req.ip,
        },
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
