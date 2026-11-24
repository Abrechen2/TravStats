/**
 * "Vergangene Tage abfragen" (spec 2026-11-23-plugins-and-calendar.md,
 * "Backfill"): one plugin asked about the stops of a past range (at most 90
 * days), as a job. Bounded by the same hourly and daily limits — it simply
 * waits for the next free call and takes longer —, skips stops the plugin has
 * already answered, and only ever suggests: an answer joins the stop's open
 * finding, or becomes a new finding when the stop has none and no visit
 * already covers it. Nothing is accepted here, ever.
 */
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { AppError } from "../../middleware/errorHandler";
import { utcMidnight } from "../countryDays/store";
import { meters, RADIUS_METERS } from "../dawarich/stays/detect";
import { coverageFor, loadCoverage } from "../dawarich/stays/coverage";
import { loadSuppression, suppressionReason } from "../dawarich/stays/suppression";
import { TRIP_SPAN_SELECT } from "../places/visitTrip";
import { visitEvidenceKey } from "../locationEvidence/key";
import { historyGeneration } from "../locationEvidence/generation";
import { getLocationProvider } from "../locationProvider/provider";
import { zoneOf } from "../../shared/time/zoneOf";
import { localDay } from "../../shared/time/instant";
import { profileZoneOf } from "../../shared/time/profileZone";
import { deriveDay } from "../travtrack/dayDerivation";
import { inPrivacyZone } from "../travtrack/classify";
import { privacyCircleSet } from "../travtrack/privacyCircles";
import { visitStopsOf } from "../travtrack/visits/stops";
import { placeOfEnrichment, withPlugins, type StopEnrichment } from "../travtrack/visits/enrich";
import {
  createFromEnrichment,
  writeEvidence,
  type FindingRunContext,
} from "../travtrack/visits/stopFindings";
import { askPlugin, MAX_SUGGESTION_DISTANCE_M, type AskDeps, type PluginAnswer } from "./ask";
import { ownPlugin } from "./registry";

export const BACKFILL_MAX_DAYS = 90;
/** How long a backfill may wait on the limits in total before it stops (and says so). */
export const BACKFILL_MAX_WAIT_MS = 24 * 60 * 60_000;
const POLL_MS = 60_000;
const DAY_MS = 86_400_000;

export interface BackfillResult {
  days: number;
  stops: number;
  asked: number;
  known: number;
  answers: number;
  created: number;
  merged: number;
  failed: Record<string, number>;
  skipped: { private: number; covered: number; answered: number; suppressed: number };
  /** The limits held it longer than `BACKFILL_MAX_WAIT_MS`: the rest is undone (run it again). */
  stoppedAt: string | null;
}

export interface BackfillDeps extends AskDeps {
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
}

const running = new Set<string>();

export function assertBackfillRange(from: string, to: string, now = new Date()): void {
  const a = utcMidnight(from).getTime();
  const b = utcMidnight(to).getTime();
  const today = utcMidnight(now.toISOString().slice(0, 10)).getTime();
  if (!(b >= a) || b > today || (b - a) / DAY_MS + 1 > BACKFILL_MAX_DAYS)
    throw new AppError("Invalid backfill range", 400, "PLUGIN_BACKFILL_REFUSED");
}

export async function prepareBackfill(userId: string, pluginId: string) {
  const plugin = await ownPlugin(userId, pluginId);
  if (!plugin.backfillAllowed || !plugin.enabled)
    throw new AppError("Backfill not allowed", 400, "PLUGIN_BACKFILL_REFUSED");
  if (running.has(plugin.id))
    throw new AppError("Backfill running", 409, "PLUGIN_BACKFILL_RUNNING");
  return plugin;
}

export async function runBackfill(
  userId: string,
  pluginId: string,
  from: string,
  to: string,
  report: (done: number, total: number) => void = () => {},
  deps: BackfillDeps = {}
): Promise<BackfillResult> {
  const plugin = await prepareBackfill(userId, pluginId);
  running.add(plugin.id);
  const result: BackfillResult = {
    days: 0,
    stops: 0,
    asked: 0,
    known: 0,
    answers: 0,
    created: 0,
    merged: 0,
    failed: {},
    skipped: { private: 0, covered: 0, answered: 0, suppressed: 0 },
    stoppedAt: null,
  };
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let waited = 0;
  try {
    const profileZone = (await profileZoneOf(userId)).zone;
    const ctx: FindingRunContext = {
      userId,
      profileZone,
      calendar: null,
      plugins: true,
      rev: (await getLocationProvider(userId)).rev,
      circles: await privacyCircleSet(userId),
      trips: await prisma.trip.findMany({
        where: { userId, status: { not: "cancelled" } },
        select: TRIP_SPAN_SELECT,
      }),
      findingsLeft: Number.MAX_SAFE_INTEGER,
      result: {
        created: 0,
        skippedPrivate: 0,
        calendarMatched: 0,
        interrupted: false,
        failed: { calendar: 0 },
        plugins: {},
      },
    };
    const suppression = await loadSuppression(userId);
    const total = (utcMidnight(to).getTime() - utcMidnight(from).getTime()) / DAY_MS + 1;
    for (let d = 0; d < total; d++) {
      const fromMs = utcMidnight(from).getTime() + d * DAY_MS;
      const window = { fromMs, untilMs: fromMs + DAY_MS };
      const generation = await historyGeneration(prisma, userId);
      const stops = visitStopsOf((await deriveDay(userId, window)).whole, window);
      const coverage = stops.length
        ? await loadCoverage(
            userId,
            new Date(Math.min(...stops.map((s) => s.fromMs))),
            new Date(Math.max(...stops.map((s) => s.untilMs)))
          )
        : null;
      for (const stop of stops) {
        result.stops++;
        if (inPrivacyZone(stop.anchor, ctx.circles(stop.fromMs))) {
          result.skipped.private++;
          continue;
        }
        const zone = zoneOf(stop.anchor) ?? "UTC";
        const forPlugin = { fromMs: stop.fromMs, untilMs: stop.untilMs, ...stop.anchor, zone };
        // Waits for the next free call; a plugin that keeps failing ends the job, said in the result.
        let outcome = await askPlugin(plugin, forPlugin, "stop", deps);
        while (outcome === "held" && waited < (deps.maxWaitMs ?? BACKFILL_MAX_WAIT_MS)) {
          await sleep(POLL_MS);
          waited += POLL_MS;
          const fresh = await prisma.suggestionPlugin.findUnique({ where: { id: plugin.id } });
          if (!fresh || !fresh.enabled) break;
          outcome = await askPlugin(fresh, forPlugin, "stop", deps);
        }
        if (outcome === "held") {
          result.stoppedAt = new Date(stop.fromMs).toISOString();
          return result;
        }
        if (outcome === "known") {
          result.known++;
          continue;
        }
        result.asked++;
        if (outcome.kind === "failed") {
          result.failed[outcome.reason] = (result.failed[outcome.reason] ?? 0) + 1;
          continue;
        }
        if (outcome.kind !== "ok") continue;
        const answers: PluginAnswer[] = outcome.suggestions.flatMap((suggestion) => {
          const distanceM =
            suggestion.lat !== undefined && suggestion.lon !== undefined
              ? meters({ lat: suggestion.lat, lon: suggestion.lon }, stop.anchor)
              : null;
          return distanceM !== null && distanceM > MAX_SUGGESTION_DISTANCE_M
            ? []
            : [{ pluginId: plugin.id, pluginName: plugin.name, suggestion, distanceM }];
        });
        if (!answers.length) continue;
        result.answers += answers.length;
        const rows = await prisma.dawarichStay.findMany({
          where: {
            userId,
            status: { not: "superseded" },
            sourceStartAt: { lte: new Date(stop.untilMs) },
            sourceEndAt: { gte: new Date(stop.fromMs) },
          },
          select: { id: true, status: true, evidence: true, sourceLat: true, sourceLon: true },
        });
        const near = rows.filter(
          (r) => meters({ lat: r.sourceLat, lon: r.sourceLon }, stop.anchor) <= RADIUS_METERS * 2
        );
        if (near.length) {
          const open = near.find((r) => r.status === "pending");
          if (!open) {
            result.skipped.answered++;
            continue;
          }
          const merged = withPlugins(
            (open.evidence ?? {}) as Record<string, unknown>,
            answers,
            null
          );
          if ((await writeEvidence(ctx, generation, open.id, merged)) === "created")
            result.merged++;
          continue;
        }
        const startAt = new Date(stop.fromMs);
        const endAt = new Date(stop.untilMs);
        const key = visitEvidenceKey({
          startMs: stop.fromMs,
          endMs: stop.untilMs,
          lat: stop.anchor.lat,
          lon: stop.anchor.lon,
        });
        const startDay = localDay(startAt, profileZone);
        if (suppressionReason(stop.anchor, startDay, suppression)) {
          result.skipped.suppressed++;
          continue;
        }
        if (
          coverage &&
          coverageFor({ startAt, endAt, ...stop.anchor, zone, evidenceKey: key }, coverage)
        ) {
          result.skipped.covered++;
          continue;
        }
        const e: StopEnrichment = {
          calendar: null,
          plugins: answers,
          calendarFailed: false,
          pluginsPending: null,
        };
        const place = await placeOfEnrichment(userId, e);
        if (!place) continue;
        const before = ctx.result.created;
        await createFromEnrichment(ctx, stop, place, e, {
          key,
          generation,
          startAt,
          endAt,
          startDay,
          zone,
          readCoverage: "complete",
        });
        result.created += ctx.result.created - before;
      }
      result.days++;
      report(result.days, total);
    }
    return result;
  } catch (error) {
    logger.warn({
      operation: "plugins.backfillFailed",
      userId,
      pluginId,
      error: (error as Error).message,
    });
    throw error;
  } finally {
    running.delete(plugin.id);
  }
}
