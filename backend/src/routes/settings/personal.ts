import { Router, Response, NextFunction } from "express";
import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { takeTravTrackLock } from "../../services/travtrack/lock";
import { narrowShareSnapshots } from "../../services/travtrack/shareNarrow";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { settingsLimiter } from "../../middleware/rateLimit";
import { putPersonalSettingsSchema, type HomePlace } from "../../schemas/companionData";
import {
  deriveHomePlace,
  withCurrentResidence,
  type HomePlaceSource,
} from "../../services/home/homePlace";
import { homePeriodsFromData, saveHomePeriods } from "../../services/home/homeStore";

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
  /** Where `homePlace` came from: the current home period's residence, or the legacy column. */
  homePlaceSource: HomePlaceSource;
  passportExpiry: string | null;
}

type StoredPersonal = {
  homePlace: Prisma.JsonValue | null;
  passportExpiry: Date | null;
  data: Prisma.JsonValue | null;
} | null;

async function toPayload(row: StoredPersonal): Promise<PersonalPayload> {
  const home = await deriveHomePlace(row);
  return {
    ...home,
    passportExpiry: row?.passportExpiry ? row.passportExpiry.toISOString().slice(0, 10) : null,
  };
}

const SELECT = { homePlace: true, passportExpiry: true, data: true } as const;

/** A calendar day as the DATE column takes it: midnight UTC of that day. */
const dayToDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/**
 * `homePlace` from an app that still knows only the place. With a current home
 * period it edits that period's residence (airports and dates stay) and the
 * legacy column follows as a mirror; without one it is the legacy write as
 * before. A shared route keeps away from the new home AND every one it
 * replaces (TravTrack plan T7): the replaced home is recorded by a trigger on
 * the column, so the column first takes the home being replaced, then the new
 * one; the narrowing runs in the same transaction under the TravTrack lock, and
 * if it fails the home does not change.
 */
async function writeHomePlace(
  userId: string,
  homePlace: HomePlace | null,
  onlyIfEmpty: boolean
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await takeTravTrackLock(tx, userId);
      // Read under the lock: a move or edit that committed meanwhile is part of what we derive from.
      const row = await tx.userSettings.findUnique({ where: { userId }, select: SELECT });
      const before = await deriveHomePlace(row);
      // `onlyIfEmpty` never overwrites a home the account already has.
      if (onlyIfEmpty && before.homePlace) return;
      if (homePlace === null && before.homePlaceSource === "period") {
        throw new AppError(
          "The home place is the current home period's residence; edit or remove that period instead",
          409,
          "HOME_PLACE_IS_PERIOD"
        );
      }
      const edited = homePlace
        ? withCurrentResidence(await homePeriodsFromData(row?.data), homePlace)
        : null;
      if (edited && before.homePlace) {
        await tx.userSettings.updateMany({
          where: { userId },
          data: { homePlace: before.homePlace },
        });
      }
      await tx.userSettings.updateMany({
        where: onlyIfEmpty ? { userId, homePlace: { equals: Prisma.DbNull } } : { userId },
        data: { homePlace: homePlace === null ? Prisma.DbNull : homePlace },
      });
      if (edited) await saveHomePeriods(userId, edited, tx);
      await narrowShareSnapshots(tx, userId);
    },
    { timeout: 60_000 }
  );
}

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const row = await prisma.userSettings.findUnique({
      where: { userId: req.userId! },
      select: SELECT,
    });
    res.json(await toPayload(row));
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

    if (homePlace !== undefined) await writeHomePlace(userId, homePlace, onlyIfEmpty);
    if (passportExpiry !== undefined) {
      await prisma.userSettings.updateMany({
        where: onlyIfEmpty ? { userId, passportExpiry: null } : { userId },
        data: { passportExpiry: passportExpiry === null ? null : dayToDate(passportExpiry) },
      });
    }

    const row = await prisma.userSettings.findUnique({ where: { userId }, select: SELECT });
    res.json(await toPayload(row));
  } catch (error) {
    next(error);
  }
});

export default router;
