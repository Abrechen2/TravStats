import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authenticate, requireWriteScope, AuthRequest } from '../middleware/auth';
import { analyticsLimiter } from '../middleware/rateLimit';
import { prisma } from '../db';

const router = Router();

router.use(authenticate);
router.use(requireWriteScope);

const ALLOWED_EVENT_TYPES = ['parser_feedback', 'pattern_suggestion'] as const;

const eventSchema = z.object({
  type: z.enum(ALLOWED_EVENT_TYPES),
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
