import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../db';

const router = Router();

router.use(authenticate);

const eventSchema = z.object({
  type: z.string().min(1),
  payload: z.any().optional(),
});

router.post('/events', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const data = eventSchema.parse(req.body);

    await prisma.analyticsEvent.create({
      data: {
        userId,
        type: data.type,
        payload: data.payload ?? {},
      },
    });

    res.status(201).json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

export default router;
