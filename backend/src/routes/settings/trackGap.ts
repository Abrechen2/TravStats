import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { settingsLimiter } from "../../middleware/rateLimit";
import { putTrackGapSchema } from "../../schemas/trackGap";
import {
  DEFAULT_TRACK_GAP_MINUTES,
  MAX_TRACK_GAP_MINUTES,
  MIN_TRACK_GAP_MINUTES,
  clampTrackGapMinutes,
} from "../../services/tripRecording/trackGapBounds";

/**
 * `/api/v1/settings/track-gap`: a recorded track is cut only where the phone
 * recorded nothing for longer than this (owner 2026-11-09, as Dawarich does
 * it — time only, never distance). Bare response family; the shared demo
 * account may read but not write (`settings/index.ts`).
 */
const router = Router();

router.use(settingsLimiter);

const view = (minutes: unknown) => ({
  minutes: clampTrackGapMinutes(minutes),
  default: DEFAULT_TRACK_GAP_MINUTES,
  min: MIN_TRACK_GAP_MINUTES,
  max: MAX_TRACK_GAP_MINUTES,
});

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const row = await prisma.userSettings.findUnique({
      where: { userId: req.userId! },
      select: { trackGapMinutes: true },
    });
    res.json(view(row?.trackGapMinutes));
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = putTrackGapSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]?.message ?? "Invalid track gap",
        400,
        "VALIDATION_FAILED"
      );
    }
    const row = await prisma.userSettings.upsert({
      where: { userId: req.userId! },
      create: { userId: req.userId!, data: {}, trackGapMinutes: parsed.data.minutes },
      update: { trackGapMinutes: parsed.data.minutes },
      select: { trackGapMinutes: true },
    });
    res.json(view(row.trackGapMinutes));
  } catch (error) {
    next(error);
  }
});

export default router;
