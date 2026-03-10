import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin, AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { testSmtpConnection } from '../../services/emailService';

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

smtpRouter.get('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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

smtpRouter.put('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = smtpUpdateSchema.parse(req.body);
    const updateData = {
      host: data.host,
      port: data.port,
      secure: data.secure,
      username: data.username,
      fromEmail: data.fromEmail,
      fromName: data.fromName,
      enabled: data.enabled,
      ...(data.password ? { password: data.password } : {}),
    };
    const config = await prisma.smtpConfig.upsert({
      where: { id: SMTP_CONFIG_ID },
      create: {
        id: SMTP_CONFIG_ID,
        host: data.host,
        port: data.port,
        secure: data.secure,
        username: data.username,
        password: data.password ?? '',
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

smtpRouter.post('/test', authenticate, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
