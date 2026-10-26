import { Router, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { settingsLimiter } from "../../middleware/rateLimit";
import { putLocationProviderSchema } from "../../schemas/locationProvider";
import {
  getLocationProvider,
  getLocationProviderChoices,
  setLocationProvider,
} from "../../services/locationProvider/provider";

/**
 * `/api/v1/settings/location-provider` (TravTrack plan, task S2): which source
 * the Companion records for and TravStats' automatic features read from.
 * Bare response family, like every settings sub-router.
 *
 * Auth and write scope come from the settings router; the shared demo account
 * may read but not write (`settings/index.ts`). A refused choice answers its
 * own 409 code and leaves the stored choice as it was.
 */
const router = Router();

router.use(settingsLimiter);

async function view(userId: string) {
  const [state, choices] = await Promise.all([
    getLocationProvider(userId),
    getLocationProviderChoices(userId),
  ]);
  return { ...state, choices };
}

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await view(req.userId!));
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = putLocationProviderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]?.message ?? "Invalid location provider",
        400,
        "VALIDATION_FAILED"
      );
    }
    await setLocationProvider(req.userId!, parsed.data.kind);
    res.json(await view(req.userId!));
  } catch (error) {
    next(error);
  }
});

export default router;
