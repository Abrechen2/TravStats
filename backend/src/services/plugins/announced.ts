/**
 * What a plugin announces about itself — its contract version, the radius it searches names in,
 * its capabilities — remembered on the plugin (`announced`). When that changes (a release that
 * adds the name match, say), the stops it answered "nothing here" in the last
 * `REASK_LOOKBACK_DAYS` are forgotten as answers, so the catch-up (`visits/enrich.ts`) asks
 * their open findings again, paced like any other catch-up. Closed findings are never asked.
 */
import { prisma } from "../../db";
import logger from "../../utils/logger";
import type { SuggestionPlugin } from "../../prisma";

export const REASK_LOOKBACK_DAYS = 14;
const DAY_MS = 86_400_000;

export type Announced = { v?: number | null; nr?: number | null; caps?: string[] | null };

const parse = (raw: string | null): Announced | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Announced;
  } catch {
    return null;
  }
};

/** Stable text: the keys in one order, capabilities sorted. */
const text = (a: Announced): string =>
  JSON.stringify({
    v: a.v ?? null,
    nr: a.nr ?? null,
    caps: a.caps ? [...a.caps].sort() : null,
  });

/**
 * Merges what this answer or hello said into the plugin's record. Returns how many earlier
 * empty answers were forgotten (0 on the first announcement: nothing to compare with).
 */
export async function noteAnnounced(
  plugin: Pick<SuggestionPlugin, "id" | "userId" | "announced">,
  patch: Announced,
  now: number,
  /** The call that carried this announcement: its own answer already heard the new version. */
  exceptCallId?: string
): Promise<number> {
  const prior = parse(plugin.announced);
  const next = text({ ...(prior ?? {}), ...patch });
  if (prior !== null && next === text(prior)) return 0;
  await prisma.suggestionPlugin.update({ where: { id: plugin.id }, data: { announced: next } });
  if (prior === null) return 0;
  const { count } = await prisma.suggestionPluginCall.updateMany({
    where: {
      pluginId: plugin.id,
      ...(exceptCallId ? { id: { not: exceptCallId } } : {}),
      outcome: "empty",
      invalidatedAt: null,
      stopStartAt: { gte: new Date(now - REASK_LOOKBACK_DAYS * DAY_MS) },
    },
    data: { invalidatedAt: new Date(now) },
  });
  logger.info({
    operation: "plugins.announcementChanged",
    userId: plugin.userId,
    pluginId: plugin.id,
    reasked: count,
  });
  return count;
}
