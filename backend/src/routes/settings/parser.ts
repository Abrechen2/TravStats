import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { defaultSettings } from './types';

const router = Router();

// GET /
// Returns parser status (Tesseract OCR and Regex always available)
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    // Ensure user settings record exists
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { userId: true },
    });

    if (!settings) {
      await prisma.userSettings.create({
        data: {
          userId,
          data: defaultSettings,
        },
      });
    }

    res.json({
      visionProvider: 'tesseract',
      textProvider: 'regex',
    });
  } catch (error) {
    next(error);
  }
});

// PUT / — parser providers are fixed (Tesseract OCR + Regex), no configurable settings
router.put('/', (_req: AuthRequest, res: Response): void => {
  res.status(501).json({
    error: 'Parser settings are not configurable. Vision provider is Tesseract OCR, text provider is Regex.',
  });
});

export default router;
