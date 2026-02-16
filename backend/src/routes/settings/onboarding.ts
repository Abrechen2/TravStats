import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { SettingsDataJson, OnboardingState, defaultSettings } from './types';

const router = Router();

const onboardingStateSchema = z.object({
  flightAdded: z.boolean().optional(),
  usedFilter: z.boolean().optional(),
  exported: z.boolean().optional(),
  mapExplored: z.boolean().optional(),
  statsViewed: z.boolean().optional(),
  achievementsViewed: z.boolean().optional(),
  dismissed: z.boolean().optional(),
}).partial();

const defaultOnboardingState: OnboardingState = {
  flightAdded: false,
  usedFilter: false,
  exported: false,
  mapExplored: false,
  statsViewed: false,
  achievementsViewed: false,
  dismissed: false,
};

// GET /
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { data: true },
    });

    if (!settings || !settings.data || typeof settings.data !== 'object') {
      res.json(defaultOnboardingState);
      return;
    }

    const data = settings.data as SettingsDataJson;
    const onboardingState = data.onboarding || defaultOnboardingState;

    // Merge with defaults to ensure all fields are present
    const merged = {
      ...defaultOnboardingState,
      ...onboardingState,
    };

    res.json(merged);
  } catch (error) {
    next(error);
  }
});

// PUT /
router.put('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const payload = onboardingStateSchema.parse(req.body);

    const existing = await prisma.userSettings.findUnique({
      where: { userId },
      select: { data: true },
    });

    const currentData: SettingsDataJson = existing?.data && typeof existing.data === 'object'
      ? (existing.data as SettingsDataJson)
      : {};

    const currentOnboarding = currentData.onboarding || defaultOnboardingState;
    const updatedOnboarding: OnboardingState = {
      ...defaultOnboardingState,
      ...currentOnboarding,
      ...payload,
    };

    const updatedData: SettingsDataJson = {
      ...currentData,
      onboarding: updatedOnboarding,
    };

    await prisma.userSettings.upsert({
      where: { userId },
      update: { data: updatedData as Prisma.InputJsonValue },
      create: {
        userId,
        data: {
          ...defaultSettings,
          onboarding: updatedOnboarding,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    res.json(updatedOnboarding);
  } catch (error) {
    next(error);
  }
});

export default router;
