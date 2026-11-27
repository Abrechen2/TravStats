/**
 * The inbox's copy of each plugin's maintenance proposals and notices (owner 2026-11-26): the
 * Plugins tab and its badge must not ask every plugin each time the inbox opens. A paced poll
 * refreshes a registration every 6 h and soon after new stops (`markMaintenanceDue`); the tab
 * reads the copy and asks live only on "Jetzt aktualisieren" (rate-limited at the route).
 *
 * A failed refresh keeps the last answer and names its reason, so the tab can show both: what the
 * plugin said last, and that it did not answer now.
 */
import { prisma } from "../../db";
import type { Prisma, SuggestionPlugin } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { egressBlock } from "../externalServices/egress";
import logger from "../../utils/logger";
import { assertMaintenanceCapable, candidateStops, runMaintenance } from "./maintenance";
import { PLUGIN_SERVICE_ID, pluginView, type Precision } from "./registry";
import { MAINTENANCE_MAX_ROWS } from "./contract";

/**
 * Rows kept per plugin from a plugin without the `withStops` filter (its unfiltered first page);
 * the settings dialog pages through the rest live.
 */
export const CACHE_ROWS = 50;
/**
 * Pages of `withStops` rows one refresh reads at most (300 rows each). Every row with a stop
 * proposal is an inbox item, so the copy must not stop at the first page; the cap only bounds a
 * runaway plugin.
 */
export const MAX_STOP_PAGES = 10;
/** How old a copy may get before the poll refreshes it. */
export const CACHE_PACE_MS = 6 * 60 * 60_000;
/** After new stops, refresh no sooner than this (stops of one drive arrive in a burst). */
export const NEW_STOPS_DELAY_MS = 10 * 60_000;
/** Registrations one poll refreshes at most; the next run takes the rest. */
const POLL_BATCH = 20;

export type CacheLocale = "de" | "en";

/** Ask one plugin live and store its answer; a failure is stored next to the last answer. */
export async function refreshMaintenanceCache(
  plugin: SuggestionPlugin,
  locale?: CacheLocale,
  now = new Date()
): Promise<void> {
  const prior = await prisma.pluginMaintenanceCache.findUnique({
    where: { pluginId: plugin.id },
    select: { locale: true },
  });
  const lang = locale ?? ((prior?.locale as CacheLocale | undefined) || "de");
  try {
    await assertMaintenanceCapable(plugin);
    const { stops, withheld } = await candidateStops(plugin.userId, plugin.precision as Precision);
    const data = await readInboxRows(plugin, lang, stops);
    const values = {
      locale: lang,
      data: data as unknown as Prisma.InputJsonValue,
      stopsSent: stops.length,
      stopsWithheld: withheld,
      refreshedAt: now,
      dueAt: null,
      failure: null,
      failedAt: null,
    };
    await prisma.pluginMaintenanceCache.upsert({
      where: { pluginId: plugin.id },
      create: { pluginId: plugin.id, userId: plugin.userId, ...values },
      update: values,
    });
  } catch (error) {
    const reason = error instanceof AppError ? error.message : "unknown";
    logger.warn({
      operation: "plugin_maintenance_cache_refresh_failed",
      pluginId: plugin.id,
      reason,
    });
    // `refreshedAt` moves too, so a plugin that is down is asked again at the pace, not every run.
    const values = { locale: lang, refreshedAt: now, dueAt: null, failure: reason, failedAt: now };
    await prisma.pluginMaintenanceCache.upsert({
      where: { pluginId: plugin.id },
      create: { pluginId: plugin.id, userId: plugin.userId, ...values },
      update: values,
    });
  }
}

type ProposalsAnswer = Awaited<ReturnType<typeof runMaintenance>> & {
  rows?: unknown[];
  totalRows?: number;
  filter?: string;
};

/**
 * The inbox's rows: every row with a stop proposal, paged through with the `withStops` filter.
 * A plugin that ignores the filter (no echo) answers its unfiltered list; then the first
 * CACHE_ROWS rows are kept, which is what the copy held before filters existed.
 */
async function readInboxRows(
  plugin: SuggestionPlugin,
  locale: CacheLocale,
  stops: unknown[]
): Promise<ProposalsAnswer> {
  const ask = async (offset: number) =>
    (await runMaintenance(plugin, "proposals", {
      locale,
      stops,
      filter: "withStops",
      offset,
      limit: MAINTENANCE_MAX_ROWS,
    })) as ProposalsAnswer;
  const first = await ask(0);
  if (first.filter !== "withStops")
    return { ...first, rows: (first.rows ?? []).slice(0, CACHE_ROWS) };
  const rows = [...(first.rows ?? [])];
  const total = first.totalRows ?? rows.length;
  for (let page = 1; page < MAX_STOP_PAGES && rows.length < total; page++) {
    const next = await ask(rows.length);
    // A plugin that stops filtering or answers nothing mid-way ends the walk, never loops.
    if (next.filter !== "withStops" || !next.rows?.length) break;
    rows.push(...next.rows);
  }
  return { ...first, rows, offset: 0 };
}

/** New stops arrived: refresh the account's copies soon instead of at the 6 h pace. */
export async function markMaintenanceDue(userId: string, now = new Date()): Promise<void> {
  const at = new Date(now.getTime() + NEW_STOPS_DELAY_MS);
  // Only rows not already due earlier; a missing row is due anyway.
  await prisma.pluginMaintenanceCache.updateMany({
    where: { userId, OR: [{ dueAt: null }, { dueAt: { gt: at } }] },
    data: { dueAt: at },
  });
}

/** The paced poll: every enabled plugin whose copy is missing, older than 6 h, or due. */
export async function refreshDueMaintenanceCaches(
  now = new Date(),
  /** One account only (tests; the schedule polls every account). */
  userId?: string
): Promise<number> {
  if (await egressBlock(PLUGIN_SERVICE_ID)) return 0;
  const stale = new Date(now.getTime() - CACHE_PACE_MS);
  const plugins = await prisma.suggestionPlugin.findMany({
    where: {
      enabled: true,
      ...(userId ? { userId } : {}),
      OR: [
        { maintenanceCache: null },
        { maintenanceCache: { refreshedAt: null } },
        { maintenanceCache: { refreshedAt: { lt: stale } } },
        { maintenanceCache: { dueAt: { lte: now } } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: POLL_BATCH,
  });
  for (const plugin of plugins) await refreshMaintenanceCache(plugin, undefined, now);
  return plugins.length;
}

/** "Jetzt aktualisieren": every enabled plugin of the account, live. */
export async function refreshAccountCaches(userId: string, locale: CacheLocale): Promise<void> {
  const block = await egressBlock(PLUGIN_SERVICE_ID);
  if (block) throw new AppError(block, 409, "SERVICE_DISABLED");
  const plugins = await prisma.suggestionPlugin.findMany({ where: { userId, enabled: true } });
  for (const plugin of plugins) await refreshMaintenanceCache(plugin, locale);
}

/**
 * What the tab reads: each enabled plugin with its copy. A plugin without maintenance
 * (`failure: "unsupported"`) is left out; one never asked yet has `refreshedAt: null`.
 */
export async function readMaintenanceInbox(userId: string) {
  const plugins = await prisma.suggestionPlugin.findMany({
    where: { userId, enabled: true },
    include: { maintenanceCache: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    blocked: await egressBlock(PLUGIN_SERVICE_ID),
    plugins: plugins
      .filter((p) => p.maintenanceCache?.failure !== "unsupported")
      .map((p) => {
        const c = p.maintenanceCache;
        return {
          plugin: pluginView(p),
          data: c?.data ?? null,
          stopsSent: c?.stopsSent ?? 0,
          stopsWithheld: c?.stopsWithheld ?? null,
          refreshedAt: c?.refreshedAt?.toISOString() ?? null,
          failure: c?.failure ?? null,
        };
      }),
  };
}
