import { Router, Response, NextFunction } from "express";
import { refreshShareSnapshots } from "../../services/travtrack/shareSnapshot";
import logger from "../../utils/logger";
import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { settingsLimiter } from "../../middleware/rateLimit";
import {
  homePlaceSchema,
  putPersonalSettingsSchema,
  type HomePlace,
} from "../../schemas/companionData";

/**
 * Personal facts the Companion used to keep on the phone only
 * (`/api/v1/settings/personal`, Companion audit 2026-10-23): the home place
 * („Heimatort", the "leave" reminder's origin) and the passport's expiry (the
 * six-month warning). Both were device-only by older Companion decisions; the
 * owner's rule of 2026-10-20 — the server knows everything, the app is a
 * companion — made the server their record.
 *
 * Their own columns, not the Companion's `app_prefs` blob: that blob is
 * replaced whole by every PUT and is restored onto whatever device pairs next,
 * while these are facts about the person. Private: no share, public link,
 * comparison or log line reads them.
 *
 * Auth and scope come from the settings router; the shared demo account may
 * read but not write (`settings/index.ts`).
 */
const router = Router();

router.use(settingsLimiter);

interface PersonalPayload {
  homePlace: HomePlace | null;
  passportExpiry: string | null;
}

type StoredPersonal = { homePlace: Prisma.JsonValue | null; passportExpiry: Date | null } | null;

function toPayload(row: StoredPersonal): PersonalPayload {
  const home = homePlaceSchema.safeParse(row?.homePlace);
  return {
    homePlace: home.success ? home.data : null,
    passportExpiry: row?.passportExpiry ? row.passportExpiry.toISOString().slice(0, 10) : null,
  };
}

const SELECT = { homePlace: true, passportExpiry: true } as const;

/** A calendar day as the DATE column takes it: midnight UTC of that day. */
const dayToDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const row = await prisma.userSettings.findUnique({
      where: { userId: req.userId! },
      select: SELECT,
    });
    res.json(toPayload(row));
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = putPersonalSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]?.message ?? "Invalid personal settings",
        400,
        "PERSONAL_SETTINGS_INVALID"
      );
    }
    const userId = req.userId!;
    const { homePlace, passportExpiry, onlyIfEmpty = false } = parsed.data;

    // The row may not exist yet; one INSERT … ON CONFLICT DO NOTHING (see web-prefs).
    await prisma.userSettings.createMany({
      data: [{ userId, data: {} as unknown as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });

    if (homePlace !== undefined) {
      await prisma.userSettings.updateMany({
        where: onlyIfEmpty ? { userId, homePlace: { equals: Prisma.DbNull } } : { userId },
        data: { homePlace: homePlace === null ? Prisma.DbNull : homePlace },
      });
      // A shared route keeps away from the NEW home too (TravTrack plan T7);
      // the recipients' read rebuilds it as well, so a failure here only logs.
      await refreshShareSnapshots(userId).catch((error: unknown) =>
        logger.warn({ operation: "travtrack.share_snapshot.refresh_failed", userId, error })
      );
    }
    if (passportExpiry !== undefined) {
      await prisma.userSettings.updateMany({
        where: onlyIfEmpty ? { userId, passportExpiry: null } : { userId },
        data: { passportExpiry: passportExpiry === null ? null : dayToDate(passportExpiry) },
      });
    }

    const row = await prisma.userSettings.findUnique({ where: { userId }, select: SELECT });
    res.json(toPayload(row));
  } catch (error) {
    next(error);
  }
});

export default router;
