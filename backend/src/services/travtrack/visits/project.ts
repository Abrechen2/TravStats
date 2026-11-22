/**
 * Place-visit suggestions from the day's stops (forgejo#316 slice 2; spec
 * 2026-11-20 travtrack-visit-detection, V2).
 *
 * E6's dirty-day protocol on its own `done` bit (`VISITS_BIT`): per run up to
 * `VISIT_DAYS_PER_RUN` days, oldest first, each day derived with the ONE
 * derivation the day view and the stop writes use (`deriveDay`). A stop on a
 * venue becomes a finding in the stay inbox (`dawarich_stays`, provider
 * `travtrack`) — so accepting, rejecting, the answered-never-resurfaces memory
 * (a rejected row keeps its coordinates), the history-deleted and privacy-zone
 * cuts and the stop's own link to its suggestion (`stayRef`) all apply to it
 * unchanged. What it adds is the evidence: the stop's window, its duration
 * split into observed and assumed time, the building chosen and its
 * sub-venue as an alternative, and the distance to it.
 *
 * Bounded: at most `VISIT_LOOKUPS_PER_RUN` venue lookups (one per stop, never
 * per fix, through the shared throttled clients) and `VISIT_FINDINGS_PER_RUN`
 * new findings per run; the rest waits for the next. A provider that did not
 * answer leaves the day open and is reported by reason (`failed`) — an outage
 * is never remembered as "no venues". Nothing is accepted here: no finding
 * becomes a visit without the owner (that is V3).
 *
 * Permission is the stay scan's own (consent, Places domain, stay switch,
 * TravTrack as the provider, the instance's TravTrack on). An account without
 * it has its days acknowledged unread — enabling suggestions later does not
 * ask about the past; "scan now" does (`rescanVisitDays`).
 */
import { prisma, type DbTransaction } from "../../../db";
import logger from "../../../utils/logger";
import { zoneOf } from "../../../shared/time/zoneOf";
import { localDay } from "../../../shared/time/instant";
import { utcMidnight } from "../../countryDays/store";
import { meters, RADIUS_METERS } from "../../dawarich/stays/detect";
import { stayScanAllowed } from "../../dawarich/stays/availability";
import { coverageFor, loadCoverage } from "../../dawarich/stays/coverage";
import { loadSuppression, suppressionReason } from "../../dawarich/stays/suppression";
import { tripForStay } from "../../dawarich/stays/tripMatch";
import { TRIP_SPAN_SELECT } from "../../places/visitTrip";
import { explanation } from "../../locationEvidence/envelope";
import { travTrackDerivationAllowed } from "../../locationEvidence/allowed";
import { historyGeneration } from "../../locationEvidence/generation";
import { visitEvidenceKey } from "../../locationEvidence/key";
import { STAY_ALGORITHM } from "../../locationEvidence/types";
import { getLocationProvider } from "../../locationProvider/provider";
import { readSuggestionSwitches } from "../../settings/suggestionSwitches";
import { travTrackInstanceOnIn } from "../availability";
import { inPrivacyZone } from "../classify";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { deriveDay } from "../dayDerivation";
import { ackDirtyDay, pendingDirtyDays, VISITS_BIT, type DirtyDay } from "../dirtyDays";
import { takeTravTrackLock } from "../lock";
import { privacyCircleSet, type CircleSet } from "../privacyCircles";
import type { Stop } from "../legs";
import {
  resolveVisit,
  type LookupFailure,
  type ResolveDeps,
  type VisitResolution,
} from "./resolve";
import { stopTimes, visitEvidence, visitStopsOf } from "./stops";
import { matchBrandRules, type BrandRuleInput } from "./brandMatch";
import { BRAND_RULE, loadBrandRules } from "../../places/brandRules";
import { acceptStay } from "../../dawarich/stays/review";

export const VISIT_DAYS_PER_RUN = 5;
export const VISIT_LOOKUPS_PER_RUN = 20;
export const VISIT_FINDINGS_PER_RUN = 20;
/** Days older than this are acknowledged unread by the schedule. */
export const VISIT_HORIZON_DAYS = 30;

const DAY_MS = 86_400_000;
const RETRY_BASE_MS = 15 * 60_000;
const RETRY_MAX_MS = 6 * 60 * 60_000;

export type VisitProjectionResult = {
  /** `paused`: the account has no permission to be asked (`why`); its days were acknowledged unread. */
  status: "done" | "disabled" | "skipped" | "paused" | "failed";
  /** Days read, answered or left open: what the run cost against the tick's day budget. */
  days: number;
  created: number;
  grown: number;
  /** A stay finding, of any status, already answers for the stop. */
  known: number;
  covered: number;
  suppressed: number;
  skippedPrivate: number;
  skippedNoZone: number;
  lodging: number;
  noVenue: number;
  /** Lookups the run's budget did not reach, or findings past its cap: they wait for the next run. */
  deferred: number;
  /** Stops whose lookup failed, by reason. The day stays open. */
  failed: Record<LookupFailure, number>;
  /** Matches of a smart list taken without asking (`autoAccept`), and those that could not be. */
  autoAccepted: number;
  autoFailed: number;
  /** Duration of every stop asked about, in minutes — what the minimum stop (spec Q2) is measured on. */
  stopMinutes: number[];
  /** The history changed under the run, or the permission went: nothing more was written. */
  interrupted: boolean;
};

export type VisitProjectionDeps = {
  maxDays?: number;
  maxLookups?: number;
  maxFindings?: number;
  now?: Date;
  /** Only days from this UTC day on (`YYYY-MM-DD`): "scan now" asks for a window, not the oldest backlog. */
  fromDay?: string;
  resolve?: ResolveDeps;
  /** Test seam: replaces the per-stop resolution. */
  resolveStop?: (stop: Stop, allowLookup: boolean) => Promise<VisitResolution>;
};

const empty = (status: VisitProjectionResult["status"]): VisitProjectionResult => ({
  status,
  days: 0,
  created: 0,
  grown: 0,
  known: 0,
  covered: 0,
  suppressed: 0,
  skippedPrivate: 0,
  skippedNoZone: 0,
  lodging: 0,
  noVenue: 0,
  deferred: 0,
  failed: { places: 0, venues: 0 },
  autoAccepted: 0,
  autoFailed: 0,
  stopMinutes: [],
  interrupted: false,
});

/** Per account, in memory: after a failed lookup the schedule waits before asking again. */
const retry = new Map<string, { until: number; failures: number }>();
export const clearVisitRetry = (): void => {
  retry.clear();
  noVenueMemory.clear();
};
export const visitRetryAfter = (userId: string): number => retry.get(userId)?.until ?? 0;

/**
 * Stops already asked about that named no venue (nothing there, or an own lodging), by stop key, in
 * memory for a day: without it a day with many such stops asks all of them again every run and the
 * stops behind them never get a turn. A restart forgets it, which only asks again.
 */
const NO_VENUE_MEMORY_MS = DAY_MS;
const NO_VENUE_MEMORY_MAX = 5000;
const noVenueMemory = new Map<string, number>();
const rememberNoVenue = (key: string, now: number): void => {
  if (noVenueMemory.size >= NO_VENUE_MEMORY_MAX) {
    const oldest = noVenueMemory.keys().next().value;
    if (oldest !== undefined) noVenueMemory.delete(oldest);
  }
  noVenueMemory.set(key, now);
};
const knownNoVenue = (key: string, now: number): boolean => {
  const at = noVenueMemory.get(key);
  return at !== undefined && now - at < NO_VENUE_MEMORY_MS;
};

const permitted = async (userId: string): Promise<boolean> =>
  !!(await prisma.dawarichStayScan.findFirst({
    where: { userId, enabled: true, ...stayScanAllowed(true, "travtrack") },
    select: { userId: true },
  }));

type RunContext = {
  userId: string;
  rev: number;
  circles: CircleSet;
  profileZone: string;
  immich: boolean;
  trips: Awaited<ReturnType<typeof loadTrips>>;
  suppression: Awaited<ReturnType<typeof loadSuppression>>;
  result: VisitProjectionResult;
  brandRules: BrandRuleInput[];
  lookupsLeft: number;
  findingsLeft: number;
  deps: VisitProjectionDeps;
};

const loadTrips = (userId: string) =>
  prisma.trip.findMany({
    where: { userId, status: { not: "cancelled" } },
    select: TRIP_SPAN_SELECT,
  });

type Published = "created" | "duplicate" | "stale" | "revoked";

/** One transaction under the TravTrack lock: still permitted, history unchanged, then the write. */
async function publish(
  userId: string,
  generation: bigint,
  write: (tx: DbTransaction) => Promise<Published>
): Promise<Published> {
  return prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    const owned = await tx.dawarichStayScan.findFirst({
      where: { userId, enabled: true, ...stayScanAllowed(true, "travtrack") },
      select: { userId: true },
    });
    if (!owned || !(await travTrackInstanceOnIn(tx))) return "revoked";
    if ((await historyGeneration(tx, userId)) !== generation) return "stale";
    return write(tx);
  });
}

type KnownRow = {
  id: string;
  status: string;
  provider: string;
  evidence: unknown;
  sourceStartAt: Date;
  sourceEndAt: Date;
};

/** The pending visit finding a longer reading of the same stop continues, or null. */
function growable(rows: readonly KnownRow[], stop: Stop): KnownRow | null {
  if (rows.length !== 1) return null;
  const row = rows[0];
  const visit = (row.evidence as { visit?: unknown } | null)?.visit;
  if (row.status !== "pending" || row.provider !== "travtrack" || !visit) return null;
  const holds =
    stop.fromMs <= row.sourceStartAt.getTime() && stop.untilMs >= row.sourceEndAt.getTime();
  const longer =
    stop.fromMs < row.sourceStartAt.getTime() || stop.untilMs > row.sourceEndAt.getTime();
  return holds && longer ? row : null;
}

function grownEvidence(old: unknown, stop: Stop) {
  const prior = (old ?? {}) as {
    visit?: Record<string, unknown>;
    explanation?: { params?: Record<string, number | string> };
  };
  const t = stopTimes(stop);
  const min = (ms: number) => Math.round(ms / 60_000);
  return {
    ...prior,
    visit: {
      ...prior.visit,
      durationMs: t.durationMs,
      observedMs: t.observedMs,
      inferredMs: t.inferredMs,
      gaps: stop.coverage?.gaps.length ?? 0,
    },
    explanation: explanation("stay.stop", {
      ...(prior.explanation?.params ?? {}),
      minutes: min(t.durationMs),
      observedMinutes: min(t.observedMs),
      inferredMinutes: min(t.inferredMs),
    }),
  };
}

/**
 * A confident match on a list that allows it is taken directly, through the same accept path the
 * owner's click uses, marked `brandRule` so it can be undone. A refusal (history changed, the
 * place was merged away, the instance switched TravTrack off) leaves the finding pending in the
 * inbox, counted and logged — never a silent loss.
 */
async function autoAccept(
  ctx: RunContext,
  key: string,
  pick: { name: string; lat: number; lon: number; placeId: string | null },
  tripId: string | null,
  startAt: Date,
  endAt: Date
): Promise<void> {
  const row = await prisma.dawarichStay.findFirst({
    where: { userId: ctx.userId, fingerprint: key, status: "pending" },
    select: { id: true },
  });
  if (!row) return;
  try {
    await acceptStay(
      ctx.userId,
      row.id,
      {
        placeId: pick.placeId,
        tripId,
        name: pick.name,
        lat: pick.lat,
        lon: pick.lon,
        startAt: { kind: "instant", utc: startAt, bareZ: false },
        endAt: { kind: "instant", utc: endAt, bareZ: false },
      },
      { createdBy: BRAND_RULE }
    );
    ctx.result.autoAccepted++;
  } catch (error) {
    ctx.result.autoFailed++;
    logger.warn({
      operation: "travtrack.visits.autoAcceptFailed",
      userId: ctx.userId,
      error: (error as Error).message,
    });
  }
}

/** One stop. Returns false when the run must stop (permission or history changed). */
async function handleStop(
  ctx: RunContext,
  stop: Stop,
  day: string,
  generation: bigint,
  coverage: Awaited<ReturnType<typeof loadCoverage>>,
  readCoverage: "complete" | "truncated"
): Promise<{ open: boolean; go: boolean }> {
  const { userId, result } = ctx;
  const minutes = Math.round((stop.untilMs - stop.fromMs) / 60_000);
  result.stopMinutes.push(minutes);
  const outcome = (what: string) =>
    logger.info({
      operation: "travtrack.visitStop",
      userId,
      minutes,
      observedMinutes: Math.round(stopTimes(stop).observedMs / 60_000),
      outcome: what,
    });
  if (inPrivacyZone(stop.anchor, ctx.circles(stop.fromMs))) {
    result.skippedPrivate++;
    outcome("private");
    return { open: false, go: true };
  }
  const zone = zoneOf(stop.anchor);
  if (!zone) {
    result.skippedNoZone++;
    outcome("noZone");
    return { open: false, go: true };
  }
  const rows = await prisma.dawarichStay.findMany({
    where: {
      userId,
      status: { not: "superseded" },
      sourceStartAt: { lte: new Date(stop.untilMs) },
      sourceEndAt: { gte: new Date(stop.fromMs) },
    },
    select: {
      id: true,
      status: true,
      provider: true,
      evidence: true,
      sourceStartAt: true,
      sourceEndAt: true,
      sourceLat: true,
      sourceLon: true,
    },
  });
  const near = rows.filter(
    (r) => meters({ lat: r.sourceLat, lon: r.sourceLon }, stop.anchor) <= RADIUS_METERS * 2
  );
  if (near.length > 0) {
    const grow = growable(near, stop);
    if (!grow) {
      result.known++;
      outcome("known");
      return { open: false, go: true };
    }
    const done = await publish(userId, generation, async (tx) => {
      const n = await tx.dawarichStay.updateMany({
        // The bounds as read: a concurrent run that already extended the row further wins.
        where: {
          id: grow.id,
          userId,
          status: "pending",
          sourceStartAt: grow.sourceStartAt,
          sourceEndAt: grow.sourceEndAt,
        },
        data: {
          sourceStartAt: new Date(stop.fromMs),
          sourceEndAt: new Date(stop.untilMs),
          startAt: new Date(stop.fromMs),
          endAt: new Date(stop.untilMs),
          evidence: grownEvidence(grow.evidence, stop) as object,
        },
      });
      return n.count ? "created" : "duplicate";
    });
    if (done === "stale" || done === "revoked") {
      result.interrupted = true;
      return { open: true, go: false };
    }
    if (done === "created") result.grown++;
    outcome("grown");
    return { open: false, go: true };
  }
  const startAt = new Date(stop.fromMs);
  const endAt = new Date(stop.untilMs);
  const key = visitEvidenceKey({
    startMs: stop.fromMs,
    endMs: stop.untilMs,
    lat: stop.anchor.lat,
    lon: stop.anchor.lon,
  });
  // The stop's own local day (the profile zone, as the day view reads it), never the scanned UTC day.
  const startDay = localDay(startAt, ctx.profileZone);
  const why = suppressionReason(stop.anchor, startDay, ctx.suppression);
  if (why) {
    result.suppressed++;
    outcome(why);
    return { open: false, go: true };
  }
  if (coverageFor({ startAt, endAt, ...stop.anchor, zone, evidenceKey: key }, coverage)) {
    result.covered++;
    outcome("covered");
    return { open: false, go: true };
  }
  const memoryKey = `${userId}:${key}`;
  if (knownNoVenue(memoryKey, Date.now())) {
    result.noVenue++;
    outcome("noVenue:remembered");
    return { open: false, go: true };
  }
  if (ctx.findingsLeft <= 0) {
    result.deferred++;
    outcome("deferred");
    return { open: true, go: true };
  }
  const allowLookup = ctx.lookupsLeft > 0;
  const resolution = ctx.deps.resolveStop
    ? await ctx.deps.resolveStop(stop, allowLookup)
    : await resolveVisit(
        userId,
        { ...stop.anchor, fromMs: stop.fromMs, untilMs: stop.untilMs },
        { staySuggestionsImmichEvidence: ctx.immich },
        { allowLookup, wantBrand: ctx.brandRules.length > 0 },
        ctx.deps.resolve
      );
  if (resolution.kind === "deferred") {
    result.deferred++;
    outcome("deferred");
    return { open: true, go: true };
  }
  if (resolution.kind === "failed") {
    ctx.lookupsLeft--;
    result.failed[resolution.reason]++;
    outcome(`failed:${resolution.reason}`);
    return { open: true, go: true };
  }
  if (resolution.kind === "none") {
    if (resolution.why === "lodging") result.lodging++;
    else {
      ctx.lookupsLeft--;
      result.noVenue++;
    }
    rememberNoVenue(memoryKey, Date.now());
    outcome(resolution.why);
    return { open: false, go: true };
  }
  if (resolution.lookedUp) ctx.lookupsLeft--;
  const { pick, lookup } = resolution;
  // A venue inside or beside a privacy zone is never offered, whatever the stop's own anchor.
  if (inPrivacyZone(pick, ctx.circles(stop.fromMs))) {
    result.skippedPrivate++;
    outcome("private");
    return { open: false, go: true };
  }
  const tripMatch = tripForStay(ctx.trips, startDay, localDay(endAt, ctx.profileZone));
  // Smart lists: matched locally on the brand tags the lookup already returned. The pick is the
  // lookup's chosen venue (never a nearest-node guess), so it is the stop's top candidate.
  const matches = matchBrandRules({
    rules: ctx.brandRules,
    venue: pick.brand,
    topCandidate: true,
    dwellMinutes: minutes,
    distanceM: pick.distanceM,
  });
  const evidence = { ...visitEvidence(stop, pick, lookup, readCoverage, matches), zone };
  const made = await publish(userId, generation, async (tx) => {
    const r = await tx.dawarichStay.createMany({
      skipDuplicates: true,
      data: [
        {
          userId,
          fingerprint: key,
          sourceStartAt: startAt,
          sourceEndAt: endAt,
          sourceLat: stop.anchor.lat,
          sourceLon: stop.anchor.lon,
          startAt,
          endAt,
          lat: pick.lat,
          lon: pick.lon,
          zone,
          pointCount: 0,
          evidence: evidence as object,
          placeId: pick.placeId ?? undefined,
          name: pick.name,
          tripId: tripMatch.trip?.id ?? null,
          provider: "travtrack",
          providerRev: ctx.rev,
          algorithmVersion: STAY_ALGORITHM,
          evidenceKey: key,
        },
      ],
    });
    return r.count ? "created" : "duplicate";
  });
  if (made === "stale" || made === "revoked") {
    result.interrupted = true;
    return { open: true, go: false };
  }
  if (made === "created") {
    result.created++;
    ctx.findingsLeft--;
    if (matches.some((m) => m.auto))
      await autoAccept(ctx, key, pick, tripMatch.trip?.id ?? null, startAt, endAt);
  }
  outcome(made === "created" ? `created:${pick.source}` : "duplicate");
  return { open: false, go: true };
}

/** One day. True when the day was fully answered and may be acknowledged. */
async function projectDay(ctx: RunContext, dirty: DirtyDay): Promise<boolean> {
  const { userId } = ctx;
  const window = {
    fromMs: utcMidnight(dirty.day).getTime(),
    untilMs: utcMidnight(dirty.day).getTime() + DAY_MS,
  };
  const generation = await historyGeneration(prisma, userId);
  const derived = await deriveDay(userId, window);
  const readCoverage = derived.raw.next === null ? "complete" : "truncated";
  const stops = visitStopsOf(derived.whole, window);
  let open = false;
  if (stops.length > 0) {
    const coverage = await loadCoverage(
      userId,
      new Date(Math.min(...stops.map((s) => s.fromMs))),
      new Date(Math.max(...stops.map((s) => s.untilMs)))
    );
    for (const stop of stops) {
      const step = await handleStop(ctx, stop, dirty.day, generation, coverage, readCoverage);
      open ||= step.open;
      if (!step.go) return false;
    }
  }
  // A day beyond the point cap is read in part, every time: leaving it open would hold the same
  // days at the front of every run. Its findings say so (`readCoverage: "truncated"`).
  if (readCoverage === "truncated")
    logger.warn({ operation: "travtrack.visits.truncatedDay", userId, day: dirty.day });
  return !open;
}

async function pendingVisitDays(
  userId: string,
  limit: number,
  fromDay: string | undefined
): Promise<DirtyDay[]> {
  if (!fromDay) return pendingDirtyDays(userId, VISITS_BIT, limit);
  const rows = await prisma.$queryRaw<{ day: Date; version: bigint }[]>`
    SELECT day, version FROM travtrack_dirty_days
     WHERE user_id = ${userId} AND (done & ${VISITS_BIT}) = 0 AND day >= ${fromDay}::date
     ORDER BY day ASC LIMIT ${limit}`;
  return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), version: r.version }));
}

async function ack(userId: string, dirty: DirtyDay): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    await ackDirtyDay(tx, userId, dirty, VISITS_BIT);
  });
}

export async function projectVisitSuggestions(
  userId: string,
  deps: VisitProjectionDeps = {}
): Promise<VisitProjectionResult> {
  const result = empty("done");
  const allowance = await travTrackDerivationAllowed(userId);
  if (allowance !== "ok")
    return { ...result, status: allowance === "disabled" ? "disabled" : "skipped" };
  const now = deps.now ?? new Date();
  const days = await pendingVisitDays(userId, deps.maxDays ?? VISIT_DAYS_PER_RUN, deps.fromDay);
  if (days.length === 0) return result;
  if (!(await permitted(userId))) {
    for (const d of days) await ack(userId, d);
    return { ...result, status: "paused", days: days.length };
  }
  try {
    const provider = await getLocationProvider(userId);
    const switches = await readSuggestionSwitches(userId);
    const ctx: RunContext = {
      userId,
      rev: provider.rev,
      circles: await privacyCircleSet(userId),
      profileZone: (await profileZoneOf(userId)).zone,
      immich: switches.staySuggestionsImmichEvidence,
      trips: await loadTrips(userId),
      suppression: await loadSuppression(userId),
      result,
      brandRules: await loadBrandRules(userId),
      lookupsLeft: deps.maxLookups ?? VISIT_LOOKUPS_PER_RUN,
      findingsLeft: deps.maxFindings ?? VISIT_FINDINGS_PER_RUN,
      deps,
    };
    const horizon = now.getTime() - VISIT_HORIZON_DAYS * DAY_MS;
    for (const dirty of days) {
      // Asked before every day: a switch stops the run, not the next one.
      if ((await travTrackDerivationAllowed(userId)) !== "ok" || !(await permitted(userId))) {
        result.interrupted = true;
        break;
      }
      // Every day read counts against the tick's budget, answered or not: a day left open
      // cost its derivation all the same.
      result.days++;
      if (utcMidnight(dirty.day).getTime() < horizon) {
        await ack(userId, dirty);
        continue;
      }
      if (await projectDay(ctx, dirty)) await ack(userId, dirty);
      if (result.interrupted) break;
    }
    return result;
  } catch (error) {
    logger.warn({ operation: "travtrack.visits.failed", userId, error: (error as Error).message });
    return { ...result, status: "failed" };
  }
}

/**
 * The schedule's entry: `projectVisitSuggestions`, waiting after a provider
 * failure (15 minutes, doubling, at most 6 hours) so an Overpass outage is not
 * asked again every tick. In memory — a restart forgets it, which only asks sooner.
 */
export async function scheduledVisitSuggestions(
  userId: string,
  deps: VisitProjectionDeps = {}
): Promise<VisitProjectionResult> {
  const now = (deps.now ?? new Date()).getTime();
  if (visitRetryAfter(userId) > now) return empty("skipped");
  const result = await projectVisitSuggestions(userId, deps);
  const failures = result.failed.places + result.failed.venues;
  if (failures > 0 || result.status === "failed") {
    const previous = retry.get(userId)?.failures ?? 0;
    retry.set(userId, {
      failures: previous + 1,
      until: now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** previous),
    });
    logger.warn({
      operation: "travtrack.visits.lookupFailed",
      userId,
      places: result.failed.places,
      venues: result.failed.venues,
    });
  } else retry.delete(userId);
  return result;
}

/**
 * "Scan now" (a job, `travtrack.visitSuggestions`): the last `lookbackDays`
 * days are marked owed again (their version raised, so a run already reading them
 * cannot acknowledge the reopening away) and asked about, ignoring the schedule's wait.
 * Findings already made are never repeated — the stop's own memory answers.
 */
export async function rescanVisitDays(
  userId: string,
  lookbackDays: number,
  deps: VisitProjectionDeps = {}
): Promise<VisitProjectionResult> {
  const from = new Date((deps.now ?? new Date()).getTime() - lookbackDays * DAY_MS);
  await prisma.$executeRaw`
    UPDATE travtrack_dirty_days SET done = done & ~${VISITS_BIT}::int, version = version + 1
     WHERE user_id = ${userId} AND day >= ${from.toISOString().slice(0, 10)}::date`;
  return projectVisitSuggestions(userId, {
    maxDays: lookbackDays + 1,
    fromDay: from.toISOString().slice(0, 10),
    ...deps,
  });
}
