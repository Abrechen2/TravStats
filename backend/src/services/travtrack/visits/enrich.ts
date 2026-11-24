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
  pending: readonly string[] | null
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
    const merged = withPlugins(next, e.plugins, e.pluginsPending);
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

export async function catchUpPlugins(
  ctx: EnrichContext,
  write: (id: string, evidence: Record<string, unknown>) => Promise<boolean>
): Promise<void> {
  if (!ctx.plugins) return;
  const rows = await prisma.$queryRaw<
    {
      id: string;
      evidence: unknown;
      source_start_at: Date;
      source_end_at: Date;
      source_lat: number;
      source_lon: number;
      zone: string;
    }[]
  >`
    SELECT id, evidence, source_start_at, source_end_at, source_lat, source_lon, zone
      FROM dawarich_stays
     WHERE user_id = ${ctx.userId} AND status = 'pending' AND provider = 'travtrack'
       AND jsonb_typeof(evidence->'pluginsPending') = 'array'
       AND jsonb_array_length(evidence->'pluginsPending') > 0
     ORDER BY source_start_at DESC
     LIMIT ${CATCH_UP_PER_RUN}`;
  for (const r of rows) {
    const asked = await askPlugins(
      ctx.userId,
      {
        fromMs: r.source_start_at.getTime(),
        untilMs: r.source_end_at.getTime(),
        lat: r.source_lat,
        lon: r.source_lon,
        zone: r.zone,
      },
      ctx.pluginDeps
    );
    for (const [k, n] of Object.entries(asked.outcomes))
      ctx.result.plugins[k] = (ctx.result.plugins[k] ?? 0) + n;
    if (!asked.asked) return;
    const merged = withPlugins(r.evidence as Record<string, unknown>, asked.answers, asked.owedIds);
    if (!(await write(r.id, merged)))
      logger.info({ operation: "plugins.catchUpSkipped", userId: ctx.userId, findingId: r.id });
  }
}
