import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import { prisma } from "../../db";
import { testSmtpConnection } from "../../services/emailService";
import { decryptApiKey, encryptApiKey } from "../../utils/encryption";
import { smtpFailureCode } from "../../services/smtpFailure";
import { recordTest } from "../../services/externalServices/tests";
import logger from "../../utils/logger";

export const SMTP_CONFIG_ID = 1 as const;

export const smtpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  username: z.string().min(1),
  password: z.string().min(1),
  fromEmail: z.string().email(),
  fromName: z.string().default("TravStats"),
  enabled: z.boolean().default(false),
});

export const smtpUpdateSchema = smtpConfigSchema.extend({
  password: z.string().min(1).optional(),
});

const smtpTestSchema = smtpConfigSchema.extend({ password: z.string().optional() });

const smtpRouter = Router();

/**
 * Keep the verdict of a test mail with the service tests ("Letzte Testmail" on
 * the E-Mail page, settings v3 S5). A failure to keep it must not turn a test
 * that ran into one that did not, so it is logged and the answer stands.
 */
async function keepVerdict(ok: boolean, code: string | null): Promise<void> {
  try {
    await recordTest(null, "smtp", ok, code);
  } catch (error) {
    logger.warn({
      operation: "smtp_test_verdict_not_kept",
      error: { message: error instanceof Error ? error.message : "unknown" },
    });
  }
}

smtpRouter.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
    if (!config) {
      res.json({ configured: false });
      return;
    }
    res.json({
      configured: true,
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
      password: "***",
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      enabled: config.enabled,
    });
  } catch (error) {
    next(error);
  }
});

smtpRouter.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = smtpUpdateSchema.parse(req.body);
    const encryptedPassword = data.password ? encryptApiKey(data.password) : undefined;
    const updateData = {
      host: data.host,
      port: data.port,
      secure: data.secure,
      username: data.username,
      fromEmail: data.fromEmail,
      fromName: data.fromName,
      enabled: data.enabled,
      ...(encryptedPassword ? { password: encryptedPassword } : {}),
    };
    const config = await prisma.smtpConfig.upsert({
      where: { id: SMTP_CONFIG_ID },
      create: {
        id: SMTP_CONFIG_ID,
        host: data.host,
        port: data.port,
        secure: data.secure,
        username: data.username,
        password: encryptApiKey(data.password ?? "") ?? "",
        fromEmail: data.fromEmail,
        fromName: data.fromName,
        enabled: data.enabled,
      },
      update: updateData,
    });
    res.json({
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
      password: "***",
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      enabled: config.enabled,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Removes the stored SMTP credentials entirely (#255). Deleting is the only way
 * to take a password back out of the instance — `PUT` can overwrite it but never
 * clear it, and the toggle only stops sending. Idempotent on purpose: an admin
 * pressing delete on an instance that has no config gets the same `configured:
 * false` answer as one that just cleared it.
 *
 * Nothing caches the row (`emailService` reads it per send), so the next
 * reminder, invitation or reset mail sees an unconfigured instance immediately.
 */
smtpRouter.delete(
  "/",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { count } = await prisma.smtpConfig.deleteMany({ where: { id: SMTP_CONFIG_ID } });
      logger.info({
        operation: "smtp_config_deleted",
        message:
          count > 0 ? "SMTP configuration deleted" : "SMTP delete on an unconfigured instance",
        userId: req.userId,
      });
      res.json({ configured: false, deleted: count > 0 });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * The test takes the form as it stands. A password left out means "the stored
 * one" (the group's "Speichern & testen" never has the clear password again).
 * Every failure answers 400 `{ success: false, code }` with a stable code; the
 * transport's own text is logged, never sent (settings rebuild, package 6).
 */
smtpRouter.post(
  "/test",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = smtpTestSchema.parse(req.body);
      let password = data.password;
      if (!password) {
        const stored = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
        password = stored?.password ? (decryptApiKey(stored.password) ?? "") : "";
      }
      if (!password) {
        res.status(400).json({ success: false, code: "SMTP_PASSWORD_MISSING" });
        return;
      }
      try {
        await testSmtpConnection({ ...data, password });
      } catch (error) {
        const code = smtpFailureCode(error);
        await keepVerdict(false, code);
        logger.warn({
          operation: "smtp_test_failed",
          code,
          error: { message: error instanceof Error ? error.message : "unknown" },
        });
        res.status(400).json({ success: false, code });
        return;
      }
      await keepVerdict(true, null);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

export default smtpRouter;
