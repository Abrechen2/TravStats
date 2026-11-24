/**
 * Asking an account's plugins about one stop (spec 2026-11-23-plugins-and-
 * calendar.md, "Limits", "Request"), with every bound the plan names:
 *
 *  - asked once per stop per plugin: an answer — "nothing here" included — is
 *    recorded and a rescan does not ask again unless the stop moved > 300 m;
 *  - one call in flight per plugin, at most 60 an hour and 300 a day; after a
 *    failure the plugin waits 15 min, doubling to 6 h, and a 429's Retry-After
 *    is honoured;
 *  - coordinates rounded to the plugin's precision before they leave; never the
 *    account's id, name or e-mail, never track points or other entries;
 *  - a suggestion more than 1 km from the stop is dropped and logged.
 *
 * A plugin that failed, or that a limit holds back, leaves the stop owed for
 * that plugin only (`owed`); the others' answers stand.
 */
import { prisma } from "../../db";
import type { SuggestionPlugin } from "../../prisma";
import logger from "../../utils/logger";
import { haversineKm } from "../../shared/geo/haversine";
import { egressBlock } from "../externalServices/egress";
import { callPlugin, type PluginOutcome } from "./client";
import { targetOf, PLUGIN_SERVICE_ID, type Precision } from "./registry";
import type { FetchLike } from "../egress/boundedFetch";
import type { PluginSuggestion } from "./contract";

export const CALLS_PER_HOUR = 60;
export const CALLS_PER_DAY = 300;
export const RETRY_BASE_MS = 15 * 60_000;
export const RETRY_MAX_MS = 6 * 60 * 60_000;
export const SAME_STOP_M = 300;
export const MAX_SUGGESTION_DISTANCE_M = 1000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const PRECISION_METERS: Record<Precision, number> = { exact: 1, "100m": 100, "1km": 1000 };
const DECIMALS: Record<Precision, number> = { exact: 5, "100m": 3, "1km": 2 };

/** A coordinate as it may leave: rounded to the plugin's precision. */
export function roundTo(value: number, precision: Precision): number {
  const f = 10 ** DECIMALS[precision];
  return Math.round(value * f) / f;
}

export interface StopForPlugins {
  fromMs: number;
  untilMs: number;
  lat: number;
  lon: number;
  zone: string;
  nearestPlace?: { name: string; distanceMeters: number };
  venue?: { name: string; category?: string };
  address?: { street?: string; postcode?: string; town?: string; country?: string };
}

export interface PluginAnswer {
  pluginId: string;
  pluginName: string;
  suggestion: PluginSuggestion;
  distanceM: number | null;
}

export interface AskResult {
  answers: PluginAnswer[];
  /** Plugins that failed or were held back: the stop is owed for them. */
  owed: number;
  owedIds: string[];
  /** False when nothing could be asked at all (switched off): what was owed stays owed. */
  asked: boolean;
  /** By outcome, for the job result: ok, empty, known, held, and each failure reason. */
  outcomes: Record<string, number>;
}

export interface AskDeps {
  fetch?: FetchLike;
  now?: () => number;
  locale?: "de" | "en";
}

const inFlight = new Set<string>();
export const clearPluginInFlight = (): void => inFlight.clear();

const meters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.round(haversineKm(a, b) * 1000);

/** What leaves the server for this plugin: the stop, rounded, and only what the account derived. */
export function stopPayload(stop: StopForPlugins, precision: Precision) {
  const exactish = precision !== "1km";
  return {
    start: new Date(stop.fromMs).toISOString(),
    end: new Date(stop.untilMs).toISOString(),
    timeZone: stop.zone,
    lat: roundTo(stop.lat, precision),
    lon: roundTo(stop.lon, precision),
    precisionMeters: PRECISION_METERS[precision],
    ...(stop.nearestPlace ? { nearestPlace: stop.nearestPlace } : {}),
    ...(stop.venue ? { venue: stop.venue } : {}),
    // The street address only at exact and 100 m: at 1 km it would undo the rounding.
    ...(exactish && stop.address ? { address: stop.address } : {}),
  };
}

/** Whether an earlier answer of this plugin already covers the stop. */
async function answered(plugin: SuggestionPlugin, stop: StopForPlugins): Promise<boolean> {
  const rows = await prisma.suggestionPluginCall.findMany({
    where: {
      pluginId: plugin.id,
      outcome: { in: ["ok", "empty"] },
      stopStartAt: { lte: new Date(stop.untilMs) },
      stopEndAt: { gte: new Date(stop.fromMs) },
    },
    select: { lat: true, lon: true },
    take: 20,
  });
  // The stored point is the rounded one: its rounding is allowed on top of the 300 m.
  const slack = SAME_STOP_M + PRECISION_METERS[plugin.precision as Precision];
  return rows.some(
    (r) => r.lat !== null && r.lon !== null && meters({ lat: r.lat, lon: r.lon }, stop) <= slack
  );
}

/** The hourly and daily allowance; false when either is spent. */
async function withinLimits(pluginId: string, now: number): Promise<boolean> {
  const [hour, day] = await Promise.all([
    prisma.suggestionPluginCall.count({
      where: { pluginId, at: { gte: new Date(now - HOUR_MS) } },
    }),
    prisma.suggestionPluginCall.count({ where: { pluginId, at: { gte: new Date(now - DAY_MS) } } }),
  ]);
  return hour < CALLS_PER_HOUR && day < CALLS_PER_DAY;
}

async function record(
  plugin: SuggestionPlugin,
  stop: StopForPlugins | null,
  outcome: PluginOutcome,
  now: number
): Promise<void> {
  const kind = outcome.kind === "failed" ? outcome.reason : outcome.kind;
  await prisma.suggestionPluginCall.create({
    data: {
      pluginId: plugin.id,
      userId: plugin.userId,
      at: new Date(now),
      outcome: kind,
      stopStartAt: stop ? new Date(stop.fromMs) : null,
      stopEndAt: stop ? new Date(stop.untilMs) : null,
      // The coordinates that were sent, rounded — never the stop's own.
      lat: stop ? roundTo(stop.lat, plugin.precision as Precision) : null,
      lon: stop ? roundTo(stop.lon, plugin.precision as Precision) : null,
      suggestions: outcome.kind === "ok" ? outcome.suggestions.length : 0,
    },
  });
  if (outcome.kind === "failed") {
    const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** plugin.failures);
    const retryAt = Math.max(now + backoff, outcome.retryAtMs ?? 0);
    await prisma.suggestionPlugin.update({
      where: { id: plugin.id },
      data: {
        lastOutcome: kind,
        lastCalledAt: new Date(now),
        lastErrorAt: new Date(now),
        failures: { increment: 1 },
        retryAt: new Date(retryAt),
      },
    });
  } else {
    await prisma.suggestionPlugin.update({
      where: { id: plugin.id },
      data: {
        lastOutcome: kind,
        lastCalledAt: new Date(now),
        failures: 0,
        retryAt: null,
        ...(outcome.version !== null ? { lastVersion: outcome.version } : {}),
      },
    });
  }
}

/** One plugin, one stop, through every bound; records what happened. */
export async function askPlugin(
  plugin: SuggestionPlugin,
  stop: StopForPlugins,
  kind: "stop" | "test",
  deps: AskDeps = {}
): Promise<PluginOutcome | "known" | "held"> {
  const now = (deps.now ?? Date.now)();
  if (kind === "stop" && (await answered(plugin, stop))) return "known";
  if (plugin.retryAt && plugin.retryAt.getTime() > now) return "held";
  if (inFlight.has(plugin.id)) return "held";
  if (!(await withinLimits(plugin.id, now))) return "held";
  inFlight.add(plugin.id);
  try {
    const target = await targetOf(plugin);
    const outcome = await callPlugin(
      target,
      { kind, stop: stopPayload(stop, plugin.precision as Precision), locale: deps.locale ?? "de" },
      deps.fetch
    );
    await record(plugin, kind === "stop" ? stop : null, outcome, now);
    if (outcome.kind === "failed")
      logger.warn({
        operation: "plugins.callFailed",
        userId: plugin.userId,
        pluginId: plugin.id,
        reason: outcome.reason,
      });
    return outcome;
  } finally {
    inFlight.delete(plugin.id);
  }
}

/** Every enabled plugin of the account about one stop. */
export async function askPlugins(
  userId: string,
  stop: StopForPlugins,
  deps: AskDeps = {}
): Promise<AskResult> {
  const result: AskResult = { answers: [], owed: 0, owedIds: [], asked: true, outcomes: {} };
  const count = (k: string) => (result.outcomes[k] = (result.outcomes[k] ?? 0) + 1);
  const plugins = await prisma.suggestionPlugin.findMany({ where: { userId, enabled: true } });
  if (plugins.length === 0) return result;
  // The admin's switch and the internet switch: off is not owed — nothing could be asked.
  if (await egressBlock(PLUGIN_SERVICE_ID)) {
    count("off");
    return { ...result, asked: false };
  }
  for (const plugin of plugins) {
    const outcome = await askPlugin(plugin, stop, "stop", deps);
    if (outcome === "known" || outcome === "held") {
      count(outcome);
      if (outcome === "held") {
        result.owed++;
        result.owedIds.push(plugin.id);
      }
      continue;
    }
    if (outcome.kind === "failed") {
      count(outcome.reason);
      result.owed++;
      result.owedIds.push(plugin.id);
      continue;
    }
    count(outcome.kind);
    if (outcome.kind !== "ok") continue;
    for (const suggestion of outcome.suggestions) {
      const distanceM =
        suggestion.lat !== undefined && suggestion.lon !== undefined
          ? meters({ lat: suggestion.lat, lon: suggestion.lon }, stop)
          : null;
      // A plugin cannot move a stop across town.
      if (distanceM !== null && distanceM > MAX_SUGGESTION_DISTANCE_M) {
        logger.warn({
          operation: "plugins.suggestionTooFar",
          userId,
          pluginId: plugin.id,
          distanceM,
        });
        count("tooFar");
        continue;
      }
      result.answers.push({ pluginId: plugin.id, pluginName: plugin.name, suggestion, distanceM });
    }
  }
  return result;
}
