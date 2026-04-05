import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

const router = Router();

const notificationPrefsSchema = z.object({
  notificationEmail: z.string().email().optional().nullable(),
  notifyBefore24h: z.boolean().optional(),
  notifyBefore2h: z.boolean().optional(),
});

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        notificationEmail: true,
        notifyBefore24h: true,
        notifyBefore2h: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.put('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const data = notificationPrefsSchema.parse(req.body);

    const updateData: {
      notificationEmail?: string | null;
      notifyBefore24h?: boolean;
      notifyBefore2h?: boolean;
    } = {};

    if (data.notificationEmail !== undefined) {
      updateData.notificationEmail = data.notificationEmail;
    }
    if (data.notifyBefore24h !== undefined) {
      updateData.notifyBefore24h = data.notifyBefore24h;
    }
    if (data.notifyBefore2h !== undefined) {
      updateData.notifyBefore2h = data.notifyBefore2h;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        notificationEmail: true,
        notifyBefore24h: true,
        notifyBefore2h: true,
      },
    });

    res.json(user);
  } catch (error) {
    next(error);
  }
});

export default router;
