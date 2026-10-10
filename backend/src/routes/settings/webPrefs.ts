import { Router, Response, NextFunction } from "express";
import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { settingsLimiter } from "../../middleware/rateLimit";
import { putWebPrefsSchema } from "../../schemas/webPrefs";
import {
  latestStamp,
  mergeWebPrefs,
  readStoredWebPrefs,
  type StoredWebPrefs,
} from "../../services/webPrefs/merge";

/**
 * The web app's per-user display preferences (`/api/v1/settings/web-prefs`,
 * forgejo#200): colours, map appearance, dashboard filter, table and stats
 * view choices — what used to live in one browser's localStorage and so did
 * not follow the user to their phone.
 *
 * Its own column (`user_settings.web_prefs`), never `app_prefs`: that one is
 * the Companion's whole blob and a PUT there REPLACES it, so a web write would
 * wipe the phone app's settings.
 *
 * Stored per section, and a PUT merges per section — a device that changed
 * the table sort does not overwrite the colours another device changed a
 * minute ago. Within one section the newer `updatedAt` wins; an older write is
 * not applied and is named in `stale`, so the client can adopt the stored one.
 *
 * Auth and scope come from the settings router (`authenticate` +
 * `requireWriteScope`): cookie sessions and PATs, read scope may GET only.
 * The limiter is mounted here, after `authenticate`, so its bucket is the
 * user's and not the household's address. The shared demo account may read
 * but not write (`rejectDemoWrites` in `settings/index.ts`): one visitor's
 * colours would otherwise become every visitor's.
 */
const router = Router();

router.use(settingsLimiter);

interface WebPrefsPayload {
  sections: StoredWebPrefs;
  updatedAt: string | null;
}

const toPayload = (prefs: StoredWebPrefs): WebPrefsPayload => ({
  sections: prefs,
  updatedAt: latestStamp(prefs),
});

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const row = await prisma.userSettings.findUnique({
      where: { userId: req.userId! },
      select: { webPrefs: true },
    });
    res.json(toPayload(readStoredWebPrefs(row?.webPrefs)));
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = putWebPrefsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]?.message ?? "Invalid web preferences",
        400,
        "WEB_PREFS_INVALID"
      );
    }
    const userId = req.userId!;

    // The row may not exist yet for an account that never saved a setting.
    // `data` is a required column; a new row starts with an empty object,
    // exactly as `/app-settings` creates one.
    // `createMany … skipDuplicates` is one `INSERT … ON CONFLICT DO NOTHING`.
    // A Prisma `upsert` with an empty `update` reads first and inserts second,
    // so two tabs saving their first preference at the same moment both found
    // no row, both inserted, and the loser failed on the unique user_id — its
    // section was lost (seen as an intermittent red "two concurrent writes" test).
    await prisma.userSettings.createMany({
      data: [{ userId, data: {} as unknown as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });

    const outcome = await prisma.$transaction(async (tx) => {
      // Row lock: two tabs saving different sections at the same moment must
      // both land. A plain read-merge-write would let the second overwrite
      // the first with the map it read before the first committed.
      const rows = await tx.$queryRaw<Array<{ web_prefs: unknown }>>`
        SELECT web_prefs FROM user_settings WHERE user_id = ${userId} FOR UPDATE`;
      const stored = readStoredWebPrefs(rows[0]?.web_prefs);
      const merged = mergeWebPrefs(stored, parsed.data.sections, new Date());
      if (!merged.ok) return merged;
      await tx.userSettings.update({
        where: { userId },
        data: {
          webPrefs: merged.next as unknown as Prisma.InputJsonValue,
          webPrefsUpdatedAt: new Date(),
        },
      });
      return merged;
    });

    if (!outcome.ok) {
      const where = outcome.section ? `section "${outcome.section}" ` : "";
      throw new AppError(
        `Web preferences refused: ${where}${outcome.problem}`,
        outcome.status,
        outcome.status === 413 ? "WEB_PREFS_TOO_LARGE" : "WEB_PREFS_INVALID"
      );
    }

    res.json({ ...toPayload(outcome.next), stale: outcome.stale, dropped: outcome.dropped });
  } catch (error) {
    next(error);
  }
});

export default router;
