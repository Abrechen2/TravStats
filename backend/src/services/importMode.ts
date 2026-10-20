import { prisma } from "../db";
import logger from "../utils/logger";
import { ensureAdminSettings } from "./instanceSettingsService";

/**
 * Import mode (forgejo#304): an admin lifts the upload and import rate limits
 * for a first import. Putting 835 kept originals on production on 2026-10-16
 * met the document limiter after 100 and would have taken eight hours, during
 * which the account could upload nothing of its own; it went around the API
 * through the container instead. A new instance has no container to go through.
 *
 * Time-boxed rather than a switch, so it cannot be forgotten open: it ends by
 * itself and the limits apply again. Only the quantity brake goes — demo
 * protection and token write scopes stay wherever they are mounted.
 */

/** How long one switch-on lasts. */
export const IMPORT_MODE_HOURS = 24;

export interface ImportModeState {
  /** ISO instant the mode ends, or null when it is off (or already over). */
  until: string | null;
  /** The one account it covers; null = every account. */
  userId: string | null;
}

/**
 * Read on every request through a limited route, so it is cached for a few
 * seconds. Switching it on or off clears the cache in this process at once.
 */
const CACHE_MS = 10_000;
let cached: { at: number; until: Date | null; userId: string | null } | null = null;

async function readMode(now: number): Promise<{ until: Date | null; userId: string | null }> {
  if (cached && now - cached.at < CACHE_MS) return cached;
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { importModeUntil: true, importModeUserId: true },
  });
  cached = { at: now, until: row?.importModeUntil ?? null, userId: row?.importModeUserId ?? null };
  return cached;
}

export async function getImportMode(now: Date = new Date()): Promise<ImportModeState> {
  const mode = await readMode(now.getTime());
  if (!mode.until || mode.until.getTime() <= now.getTime()) return { until: null, userId: null };
  return { until: mode.until.toISOString(), userId: mode.userId };
}

/** Whether the limits are lifted for this account right now. */
export async function importModeCovers(userId: string, now: Date = new Date()): Promise<boolean> {
  const mode = await getImportMode(now);
  return mode.until !== null && (mode.userId === null || mode.userId === userId);
}

/** Switch it on for `IMPORT_MODE_HOURS`, for one account or for all. */
export async function startImportMode(
  adminId: string,
  userId: string | null,
  now: Date = new Date()
): Promise<ImportModeState> {
  const row = await ensureAdminSettings();
  const until = new Date(now.getTime() + IMPORT_MODE_HOURS * 3_600_000);
  await prisma.adminSettings.update({
    where: { id: row.id },
    data: { importModeUntil: until, importModeUserId: userId },
  });
  cached = null;
  logger.info(
    { operation: "admin.importMode.start", adminId, userId, until: until.toISOString() },
    "import mode switched on"
  );
  return { until: until.toISOString(), userId };
}

/** End it now, before its time is up. */
export async function stopImportMode(adminId: string): Promise<ImportModeState> {
  const row = await ensureAdminSettings();
  await prisma.adminSettings.update({
    where: { id: row.id },
    data: { importModeUntil: null, importModeUserId: null },
  });
  cached = null;
  logger.info({ operation: "admin.importMode.stop", adminId }, "import mode switched off");
  return { until: null, userId: null };
}

/** Tests only: forget the cached row. */
export function resetImportModeCache(): void {
  cached = null;
}
