/**
 * Per-account WebDAV sync of the account's own data export (forgejo#321,
 * Einstellungen › Daten › "Mit WebDAV abgleichen"). Mounted under
 * `/api/v1/settings/webdav-sync`, whose parent router applies `authenticate`
 * + `requireWriteScope`, and keeps the shared demo account out of writes.
 *
 * The password is write-only: it goes in encrypted and never comes back —
 * the answer says `hasPassword`. Every failure is a stable code in `error`
 * (`services/webdavSync/errors.ts`), never prose, so the page words it.
 *
 * Bare response family (docs/adr/0001-api-response-shape.md).
 */
import { Router, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { patAwareMax, userOrIpKey } from "../../middleware/rateLimit";
import { encryptApiKey } from "../../utils/encryption";
import logger from "../../utils/logger";
import { startJob } from "../../services/jobs/jobRegistry";
import { WebdavSyncError } from "../../services/webdavSync/errors";
import { isWebdavSyncRunning, runWebdavSync } from "../../services/webdavSync/runSync";
import { normalizeWebdavUrl } from "../../services/webdavSync/targetPolicy";

const router = Router();

export const WEBDAV_SCHEDULES = ["daily", "weekly"] as const;

/** A folder on the share: absolute, no `..`, no control characters. */
const remotePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((p) => p.startsWith("/"), "remotePath must be an absolute path")
  .refine(
    (p) => ![...p].some((c) => c === "\\" || c.charCodeAt(0) < 32),
    "remotePath must not contain control characters or backslashes"
  )
  .refine((p) => !p.split("/").includes(".."), "remotePath must not contain '..'")
  .transform((p) => (p.endsWith("/") ? p : `${p}/`));

export const webdavSyncUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    url: z.string().trim().max(500).nullable().optional(),
    username: z.string().trim().max(200).nullable().optional(),
    /** Absent = keep the stored one; null = remove it. */
    password: z.string().min(1).max(500).nullable().optional(),
    remotePath: remotePathSchema.optional(),
    schedule: z.enum(WEBDAV_SCHEDULES).optional(),
    keepVersions: z.number().int().min(1).max(30).optional(),
  })
  .strict();

/**
 * "Jetzt abgleichen" builds a whole account's export and uploads it: a few a
 * minute are a person retrying after fixing the password, more is a script.
 */
const runLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: patAwareMax(10),
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
});

async function readStatus(userId: string, isAdmin: boolean): Promise<Record<string, unknown>> {
  const row = await prisma.userWebdavSync.findUnique({ where: { userId } });
  return {
    enabled: row?.enabled ?? false,
    url: row?.url ?? null,
    username: row?.username ?? null,
    hasPassword: Boolean(row?.passwordEncrypted),
    remotePath: row?.remotePath ?? "/TravStats/",
    schedule: row?.schedule ?? "daily",
    keepVersions: row?.keepVersions ?? 5,
    // The server's own clock, at no traveller's place (ADR 0002 bookkeeping
    // instants): when the last run was attempted, and when one last succeeded.
    ranAt: row?.lastAttemptAt?.toISOString() ?? null,
    completedAt: row?.lastSuccessAt?.toISOString() ?? null,
    lastStatus: row?.lastStatus ?? null,
    lastErrorCode: row?.lastErrorCode ?? null,
    lastFileName: row?.lastFileName ?? null,
    lastSizeBytes: row?.lastSizeBytes ?? null,
    running: isWebdavSyncRunning(userId),
    // What the page explains under the URL field: whether a LAN share is allowed.
    allowPrivateTargets: isAdmin,
  };
}

async function callerIsAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  return user?.isAdmin ?? false;
}

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    res.json(await readStatus(userId, await callerIsAdmin(userId)));
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const parsed = webdavSyncUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError("invalidInput", 400);
    const payload = parsed.data;
    const isAdmin = await callerIsAdmin(userId);

    const data: Record<string, unknown> = {};
    if (payload.url !== undefined) {
      if (payload.url === null || payload.url === "") {
        data.url = null;
      } else {
        try {
          data.url = normalizeWebdavUrl(payload.url, { allowPrivate: isAdmin });
        } catch (error) {
          throw new AppError(error instanceof WebdavSyncError ? error.code : "invalidUrl", 400);
        }
      }
    }
    if (payload.username !== undefined) data.username = payload.username || null;
    if (payload.password !== undefined) {
      data.passwordEncrypted = payload.password === null ? null : encryptApiKey(payload.password);
    }
    if (payload.remotePath !== undefined) data.remotePath = payload.remotePath;
    if (payload.schedule !== undefined) data.schedule = payload.schedule;
    if (payload.keepVersions !== undefined) data.keepVersions = payload.keepVersions;
    if (payload.enabled !== undefined) data.enabled = payload.enabled;

    // Switched on without somewhere to go would fail every night; say so now.
    const current = await prisma.userWebdavSync.findUnique({ where: { userId } });
    const merged = { ...current, ...data };
    if (merged.enabled && (!merged.url || !merged.username || !merged.passwordEncrypted)) {
      throw new AppError("notConfigured", 400);
    }

    await prisma.userWebdavSync.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    logger.info({
      operation: "webdav_user_sync_settings_updated",
      userId,
      // Field names only: never a value, and never the password.
      fields: Object.keys(data),
    });
    res.json(await readStatus(userId, isAdmin));
  } catch (error) {
    next(error);
  }
});

/** "Jetzt abgleichen": 202 with a job; the page polls `/jobs/:id`. */
router.post(
  "/run",
  runLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const row = await prisma.userWebdavSync.findUnique({ where: { userId } });
      if (!row?.enabled) throw new AppError("notConfigured", 409);
      // A second job started in the same tick fails with the same code inside
      // `runWebdavSync`, without touching the recorded result.
      if (isWebdavSyncRunning(userId)) throw new AppError("alreadyRunning", 409);
      const job = startJob("webdavSync.run", userId, () => runWebdavSync(userId));
      res.status(202).json({ jobId: job.id });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
