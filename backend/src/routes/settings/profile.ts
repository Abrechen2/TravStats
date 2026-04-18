import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

const router = Router();

// Minimal user-level profile fields that aren't in UserSettings JSON.
// Currently just birthdate — used by the BIRTHDAY_FLIGHT achievement to
// match a flight's departure month+day against the user.
const profileSchema = z.object({
  // Accept YYYY-MM-DD or a full ISO datetime; null clears the field.
  birthdate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'Expected YYYY-MM-DD')
    .nullable()
    .optional(),
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
      select: { birthdate: true },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      birthdate: user.birthdate ? user.birthdate.toISOString().slice(0, 10) : null,
    });
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

    const data = profileSchema.parse(req.body);

    const updateData: { birthdate?: Date | null } = {};
    if (data.birthdate === null) {
      updateData.birthdate = null;
    } else if (typeof data.birthdate === 'string') {
      // Normalize to date-only at noon UTC so local-TZ comparisons against
      // departure-time month+day stay correct regardless of server TZ.
      const d = new Date(`${data.birthdate.slice(0, 10)}T12:00:00.000Z`);
      if (isNaN(d.getTime())) {
        res.status(400).json({ error: 'Invalid birthdate' });
        return;
      }
      updateData.birthdate = d;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { birthdate: true },
    });

    res.json({
      birthdate: user.birthdate ? user.birthdate.toISOString().slice(0, 10) : null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
