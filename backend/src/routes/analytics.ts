import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { analyticsLimiter } from '../middleware/rateLimit';
import { prisma } from '../db';

const router = Router();

router.use(authenticate);

const eventSchema = z.object({
  type: z.string().min(1).max(100),
  payload: z.record(z.unknown()).optional().refine((val) => {
    const size = JSON.stringify(val || {}).length;
    return size <= 10000; // 10KB limit
  }, { message: 'Payload too large (max 10KB)' }),
});

router.post('/events', analyticsLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const data = eventSchema.parse(req.body);

    await prisma.analyticsEvent.create({
      data: {
        userId,
        type: data.type,
        payload: (data.payload ?? {}) as Prisma.InputJsonValue,
      },
    });

    res.status(201).json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

export default router;
