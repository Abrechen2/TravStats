/**
 * What the calendar and the suggestion plugins add to a stop (spec
 * 2026-11-23-plugins-and-calendar.md): asked together, merged into the ONE
 * finding of the stop — `evidence.calendar`, `evidence.plugins[]`, and the
 * purpose the evidence suggests. No new inbox.
 *
 * A plugin that did not answer never holds the day (one broken plugin would
 * starve every newer day): the finding names it in `pluginsPending`, and the
 * next runs ask it again for open findings (`catchUpPlugins`); a stop without a
 * finding is reached by the plugin's backfill.
 */
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { countryFromCoordinates } from "../../geo/countryFromCoordinates";
import {
  askPlugins,
  type AskDeps,
  type PluginAnswer,
  type StopForPlugins,
} from "../../plugins/ask";
import type { NamedPlace } from "../../calendar/match";
import { ownerStopName } from "../stopPlaces/ownerName";
import { matchStop, withCalendar, type CalendarContext, type CalendarMatch } from "./calendarMatch";

export interface EnrichContext {
  userId: string;
  profileZone: string;
  calendar: CalendarContext | null;
  /** The account has an enabled plugin. */
  plugins: boolean;
  pluginDeps?: AskDeps;
  result: {
    failed: { calendar: number };
    plugins: Record<string, number>;
  };
}

export interface StopEnrichment {
  calendar: CalendarMatch | null;
  plugins: PluginAnswer[];
  /** A calendar source or an event's geocoding did not answer: the day is owed. */
  calendarFailed: boolean;
  /** Plugins that did not answer this time (asked again by `catchUpPlugins`); null: none asked. */
  pluginsPending: string[] | null;
  /** Plugins that answered this time, "nothing here" included (the inbox offers "Neu fragen"). */
  pluginsAnswered?: string[];
}

export interface StopInput {
  fromMs: number;
  untilMs: number;
  lat: number;
  lon: number;
  zone: string;
}

export type Address = {
  address: string | null;
  city: string | null;
  country: string | null;
} | null;

/** One stop, both sources. `venue` is the place V2 found (or the finding's), `own` whether it is an own place. */
export async function enrichStop(
  ctx: EnrichContext,
  stop: StopInput,
  venue: (NamedPlace & { category?: string; own: boolean; distanceM: number }) | null,
  address: Address | undefined
): Promise<StopEnrichment> {
  const span = { fromMs: stop.fromMs, untilMs: stop.untilMs, lat: stop.lat, lon: stop.lon };
  const cal = ctx.calendar
    ? await matchStop(ctx.calendar, span, venue)
    : { match: null, failed: false };
  if (cal.failed) ctx.result.failed.calendar++;
  if (!ctx.plugins)
    return { calendar: cal.match, plugins: [], calendarFailed: cal.failed, pluginsPending: null };
  const country = address ? await countryFromCoordinates(stop.lat, stop.lon) : null;
  const forPlugins: StopForPlugins = {
    ...stop,
    ...(venue && venue.own
      ? { nearestPlace: { name: venue.name, distanceMeters: venue.distanceM } }
      : {}),
    ...(venue && !venue.own
      ? { venue: { name: venue.name, ...(venue.category ? { category: venue.category } : {}) } }
      : {}),
    ...(address && (address.address || address.city)
      ? {
          address: {
            ...(address.address ? { street: address.address } : {}),
            ...(address.city ? { town: address.city } : {}),
            ...(country ? { country } : {}),
          },
        }
      : {}),
  };
  const asked = await askPlugins(ctx.userId, forPlugins, ctx.pluginDeps);
  for (const [k, n] of Object.entries(asked.outcomes))
    ctx.result.plugins[k] = (ctx.result.plugins[k] ?? 0) + n;
  return {
    calendar: cal.match,
    plugins: asked.answers,
    calendarFailed: cal.failed,
    pluginsPending: asked.asked ? asked.owedIds : null,
    pluginsAnswered: asked.answeredIds,
  };
}

const best = (answers: readonly PluginAnswer[]) =>
  [...answers].sort((a, b) => b.suggestion.confidence - a.suggestion.confidence)[0] ?? null;

/**
 * A finding's evidence with the plugins' answers merged; each plugin's latest answer replaces its
 * last. `pending`: the plugins still owed after asking every enabled one (null: none was asked,
 * what was owed stays owed).
 */
export function withPlugins(
  evidence: Record<string, unknown>,
  answers: readonly PluginAnswer[],
  pending: readonly string[] | null,
  answered: readonly string[] = []
): Record<string, unknown> {
  const answeredIds = new Set(answers.map((a) => a.pluginId));
  const prior = Array.isArray(evidence.plugins)
    ? (evidence.plugins as { pluginId?: string }[]).filter(
        (p) => !answeredIds.has(p.pluginId ?? "")
      )
    : [];
  const receivedAt = new Date().toISOString();
  const plugins = [
    ...prior,
    ...answers.map((a) => ({
      pluginId: a.pluginId,
      pluginName: a.pluginName,
      ...a.suggestion,
      distanceM: a.distanceM,
      receivedAt,
    })),
  ];
  const top = best(answers);
  const priorPending = Array.isArray(evidence.pluginsPending)
    ? (evidence.pluginsPending as string[])
    : [];
  const stillPending = pending ?? priorPending;
  const next: Record<string, unknown> = { ...evidence };
  if (plugins.length) next.plugins = plugins;
  if (stillPending.length) next.pluginsPending = stillPending;
  else delete next.pluginsPending;
  // Which plugins were asked about this stop, so an empty answer can still be asked again.
  const asked = new Set([
    ...(Array.isArray(evidence.pluginsAsked) ? (evidence.pluginsAsked as string[]) : []),
    ...answered,
  ]);
  if (asked.size) next.pluginsAsked = [...asked];
  if (top?.suggestion.purpose && !next.suggestedPurpose) {
    next.suggestedPurpose = top.suggestion.purpose;
    next.suggestedPurposeFrom = `plugin:${top.pluginId}`;
  }
  return next;
}

/** Both sources merged; null when nothing new came. */
export function withEnrichment(
  evidence: unknown,
  e: StopEnrichment
): Record<string, unknown> | null {
  let next = (evidence ?? {}) as Record<string, unknown>;
  let changed = false;
  if (e.calendar) {
    const merged = withCalendar(next, e.calendar);
    if (merged) {
      next = merged;
      changed = true;
    }
  }
  if (e.pluginsPending !== null) {
    const merged = withPlugins(next, e.plugins, e.pluginsPending, e.pluginsAnswered);
    if (JSON.stringify(merged) !== JSON.stringify(next)) {
      next = merged;
      changed = true;
    }
  }
  return changed ? next : null;
}

export interface EnrichedPlace {
  name: string;
  lat: number;
  lon: number;
  placeId: string | null;
  /** `calendar` or `plugin:<id>`: what made a finding of a stop with no venue. */
  createdFrom: string;
  distanceM: number;
}

/** Where a stop with no venue was, by the evidence: the calendar's place first, else the plugins' best. */
export async function placeOfEnrichment(
  userId: string,
  e: StopEnrichment
): Promise<EnrichedPlace | null> {
  if (e.calendar?.place)
    return {
      name: e.calendar.name,
      ...e.calendar.place,
      createdFrom: "calendar",
      distanceM: e.calendar.evidence.geocoded?.distanceM ?? 0,
    };
  const located = e.plugins.filter(
    (a) => a.suggestion.lat !== undefined && a.suggestion.lon !== undefined
  );
  const top = best(located);
  if (!top) return null;
  // A second visit finds the place a first accept made from the same plugin reference.
  const own = top.suggestion.externalRef
    ? await prisma.place.findFirst({
        where: { userId, externalRef: `plugin:${top.pluginId}:${top.suggestion.externalRef}` },
        select: { id: true },
      })
    : null;
  return {
    name: top.suggestion.name,
    lat: top.suggestion.lat!,
    lon: top.suggestion.lon!,
    placeId: own?.id ?? null,
    createdFrom: `plugin:${top.pluginId}`,
    distanceM: top.distanceM ?? 0,
  };
}

/** Open findings still waiting for a plugin's answer, a few per run. */
export const CATCH_UP_PER_RUN = 10;
/**
 * How far back the catch-up looks for open findings no plugin has answered. A stop is
 * "missed" when no run asked about it at all — the projection was starved by a backlog,
 * or the finding came from the stay scan before this projection reached the stop.
 */
export const MISSED_LOOKBACK_DAYS = 14;
const DAY_MS = 86_400_000;

type CatchUpRow = {
  id: string;
  evidence: unknown;
  source_start_at: Date;
  source_end_at: Date;
  source_lat: number;
  source_lon: number;
  zone: string;
  name: string | null;
  place_id: string | null;
};

/** The name the finding or the owner gave the stop: what lets a plugin match by name. */
async function stopName(
  userId: string,
  r: CatchUpRow
): Promise<Pick<StopForPlugins, "venue" | "nearestPlace">> {
  // The owner's own name for the stop first: it wins over the finding's guess.
  const owner = await ownerStopName(userId, {
    fromMs: r.source_start_at.getTime(),
    untilMs: r.source_end_at.getTime(),
  });
  if (owner) return { venue: { name: owner.name } };
  if (!r.name) return {};
  return r.place_id
    ? { nearestPlace: { name: r.name, distanceMeters: 0 } }
    : { venue: { name: r.name } };
}

/**
 * Open findings a plugin still owes (`pluginsPending`) first, then the ones no enabled plugin
 * ever answered within `MISSED_LOOKBACK_DAYS`, newest first, at most `CATCH_UP_PER_RUN` asks a
 * run. Each ask still goes through every bound of `askPlugin` (once per stop, the hourly and
 * daily limits, the backoff), so a run every quarter hour stays inside the plugin's allowance.
 */
export async function catchUpPlugins(
  ctx: EnrichContext,
  write: (id: string, evidence: Record<string, unknown>) => Promise<boolean>,
  now: Date = new Date()
): Promise<void> {
  if (!ctx.plugins) return;
  const owed = await prisma.$queryRaw<CatchUpRow[]>`
    SELECT id, evidence, source_start_at, source_end_at, source_lat, source_lon, zone, name, place_id
      FROM dawarich_stays
     WHERE user_id = ${ctx.userId} AND status = 'pending' AND provider = 'travtrack'
       AND jsonb_typeof(evidence->'pluginsPending') = 'array'
       AND jsonb_array_length(evidence->'pluginsPending') > 0
     ORDER BY source_start_at DESC
     LIMIT ${CATCH_UP_PER_RUN}`;
  const left = CATCH_UP_PER_RUN - owed.length;
  const since = new Date(now.getTime() - MISSED_LOOKBACK_DAYS * DAY_MS);
  // Answered = an `ok`/`empty` call of an enabled plugin over the finding's time, not forgotten
  // ("Neu fragen"). Fewer answering plugins than enabled ones: someone was never asked.
  const missed =
    left > 0
      ? await prisma.$queryRaw<CatchUpRow[]>`
    SELECT s.id, s.evidence, s.source_start_at, s.source_end_at, s.source_lat, s.source_lon,
           s.zone, s.name, s.place_id
      FROM dawarich_stays s
     WHERE s.user_id = ${ctx.userId} AND s.status = 'pending' AND s.provider = 'travtrack'
       AND s.source_start_at >= ${since}
       AND COALESCE(jsonb_typeof(s.evidence->'pluginsPending') <> 'array'
                    OR jsonb_array_length(s.evidence->'pluginsPending') = 0, true)
       AND (SELECT count(DISTINCT c.plugin_id)
              FROM suggestion_plugin_calls c
              JOIN suggestion_plugins p ON p.id = c.plugin_id AND p.enabled
             WHERE c.user_id = s.user_id AND c.outcome IN ('ok', 'empty')
               AND c.invalidated_at IS NULL
               AND c.stop_start_at <= s.source_end_at AND c.stop_end_at >= s.source_start_at)
           < (SELECT count(*) FROM suggestion_plugins p
               WHERE p.user_id = s.user_id AND p.enabled)
     ORDER BY s.source_start_at DESC
     LIMIT ${left}`
      : [];
  for (const r of [...owed, ...missed]) {
    const asked = await askPlugins(
      ctx.userId,
      {
        fromMs: r.source_start_at.getTime(),
        untilMs: r.source_end_at.getTime(),
        lat: r.source_lat,
        lon: r.source_lon,
        zone: r.zone,
        ...(await stopName(ctx.userId, r)),
      },
      ctx.pluginDeps
    );
    for (const [k, n] of Object.entries(asked.outcomes))
      ctx.result.plugins[k] = (ctx.result.plugins[k] ?? 0) + n;
    if (!asked.asked) return;
    const merged = withPlugins(
      r.evidence as Record<string, unknown>,
      asked.answers,
      asked.owedIds,
      asked.answeredIds
    );
    // Nothing new (every plugin had answered already): no write, no publish.
    if (JSON.stringify(merged) === JSON.stringify(r.evidence)) continue;
    if (!(await write(r.id, merged)))
      logger.info({ operation: "plugins.catchUpSkipped", userId: ctx.userId, findingId: r.id });
  }
}
