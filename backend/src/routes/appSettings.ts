import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { settingsLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { putAppSettingsSchema } from "../schemas/appSettings";

/**
 * App-settings backup/sync (`/api/v1/app-settings`).
 *
 * A per-user opaque JSON "preferences" blob the mobile app saves to and
 * restores from, so a re-paired / new device can auto-restore the user's
 * app settings (units, formats, …). The blob is scoped to the calling
 * user's `userId` — a token can only ever read or write its own owner's
 * prefs.
 *
 * Auth: Bearer PAT (the mobile app's transport) OR cookie session, via the
 * shared `authenticate` middleware. `requireWriteScope` (method-aware)
 * lets read-scoped tokens GET but blocks them from PUT; write- and
 * admin-scoped tokens may do both. Cookie sessions are unconstrained.
 */

const router = Router();

router.use(settingsLimiter);
router.use(authenticate);
// GET passes through for any valid token; PUT needs write (or admin) scope.
router.use(requireWriteScope);

interface AppSettingsPayload {
  prefs: Prisma.JsonValue | null;
  updatedAt: string | null;
}

const toPayload = (
  prefs: Prisma.JsonValue | null | undefined,
  updatedAt: Date | null | undefined
): AppSettingsPayload => ({
  prefs: prefs ?? null,
  updatedAt: updatedAt ? updatedAt.toISOString() : null,
});

// GET — return the calling user's stored prefs (or null if none yet).
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const settings = await prisma.userSettings.findUnique({
      where: { userId: req.userId! },
      select: { appPrefs: true, appPrefsUpdatedAt: true },
    });
    res.json(toPayload(settings?.appPrefs, settings?.appPrefsUpdatedAt));
  } catch (error) {
    next(error);
  }
});

// PUT — upsert the calling user's prefs. Honour a client-provided
// `updatedAt` (last-write-wins from the device clock) else stamp now().
router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = putAppSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message ?? "Invalid app settings", 400);
    }

    const { prefs, updatedAt } = parsed.data;
    const stamp = updatedAt ? new Date(updatedAt) : new Date();
    const prefsJson = prefs as unknown as Prisma.InputJsonValue;

    const saved = await prisma.userSettings.upsert({
      where: { userId: req.userId! },
      update: { appPrefs: prefsJson, appPrefsUpdatedAt: stamp },
      create: {
        userId: req.userId!,
        // `data` is a required non-null column on user_settings; new rows
        // created via this route get an empty settings object.
        data: {} as unknown as Prisma.InputJsonValue,
        appPrefs: prefsJson,
        appPrefsUpdatedAt: stamp,
      },
      select: { appPrefs: true, appPrefsUpdatedAt: true },
    });

    res.json(toPayload(saved.appPrefs, saved.appPrefsUpdatedAt));
  } catch (error) {
    next(error);
  }
});

export default router;
