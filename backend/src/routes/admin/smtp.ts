import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { testSmtpConnection } from '../../services/emailService';
import { encryptApiKey } from '../../utils/encryption';
import logger from '../../utils/logger';

export const SMTP_CONFIG_ID = 1 as const;

export const smtpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  username: z.string().min(1),
  password: z.string().min(1),
  fromEmail: z.string().email(),
  fromName: z.string().default('TravStats'),
  enabled: z.boolean().default(false),
});

export const smtpUpdateSchema = smtpConfigSchema.extend({
  password: z.string().min(1).optional(),
});

const smtpRouter = Router();

smtpRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
      password: '***',
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      enabled: config.enabled,
    });
  } catch (error) {
    next(error);
  }
});

smtpRouter.put('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
        password: encryptApiKey(data.password ?? '') ?? '',
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
      password: '***',
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
smtpRouter.delete('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { count } = await prisma.smtpConfig.deleteMany({ where: { id: SMTP_CONFIG_ID } });
    logger.info({
      operation: 'smtp_config_deleted',
      message: count > 0 ? 'SMTP configuration deleted' : 'SMTP delete on an unconfigured instance',
      userId: req.userId,
    });
    res.json({ configured: false, deleted: count > 0 });
  } catch (error) {
    next(error);
  }
});

smtpRouter.post('/test', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = smtpConfigSchema.parse(req.body);
    await testSmtpConnection(data);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
      return;
    }
    next(error);
  }
});

export default smtpRouter;
