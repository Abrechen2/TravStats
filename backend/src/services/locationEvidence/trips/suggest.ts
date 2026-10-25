/**
 * Trip inference (TravTrack plan L4): an away-from-home period TravTrack saw
 * and no trip holds becomes a question in the inbox — "Du warst unterwegs; war
 * das eine Reise?". TravStats code: it reads TravTrack through E2 (via
 * `awayPeriods`) and writes `location_suggestions` rows only; a trip is made
 * or widened only by the user's answer (`accept.ts`, rule 6).
 *
 * Runs only while the instance's TravTrack is on and the account's provider is
 * `travtrack` (`travTrackDerivationAllowed`) — never for Dawarich (open owner
 * decision (c)) — and only for an account with a confirmed residence.
 *
 * Bounded (review focus 19): nightly, over the last `TRIP_WINDOW_DAYS`
 * finished local days only — never the whole history, and never because an
 * import landed. A run that touches the first day read may have begun before
 * it and is not judged. At most `MAX_NEW_TRIP_QUESTIONS` new questions per
 * run become cards, the newest first; the rest are stored `aggregated` and the
 * inbox shows them inside one "Weitere N Zeiträume unterwegs" entry that
 * expands on request.
 *
 * Against the logbook: a run whose away days all lie in one trip is held
 * already — nothing to ask. A run that overlaps a trip, or ends the day before
 * one begins (or begins the day after one ends), asks to widen that trip
 * (`trip.extend`); any other asks for a new one (`trip.away`).
 *
 * One question per run, keyed by its first day: a pending question grows while
 * the run goes on; an answered one (rejected, accepted, invalidated) is never
 * asked again, nor is a run that overlaps it.
 *
 * Published under the TravTrack lock with the generation the read captured
 * (E5's fence): a removal that landed while it read publishes nothing.
 */
import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { now } from "../../../shared/time/clock";
import { startOfDayAt } from "../../../shared/time/legacyValues";
import { fromDbDate } from "../../../shared/time/localDate";
import logger from "../../../utils/logger";
import { getLocationProvider } from "../../locationProvider/provider";
import { takeTravTrackLock } from "../../travtrack/lock";
import { travTrackDerivationAllowed, type DerivationAllowance } from "../allowed";
import { explanation } from "../envelope";
import { historyGeneration } from "../generation";
import { tripEvidenceKey } from "../key";
import { awayPeriods, homeToday, shiftDay, type AwayRun } from "./awayPeriods";
import { parseTripEvidence, type TripEvidence } from "./evidence";

/** The trip detector's version (`location_suggestions.algorithm`). */
export const TRIP_ALGORITHM = 1;
export const TRIP_WINDOW_DAYS = 60;
export const MAX_NEW_TRIP_QUESTIONS = 3;

export type SuggestTripsResult = {
  status: "done" | "skipped" | "stale" | "cancelled";
  reason?: Exclude<DerivationAllowance, "ok"> | "noResidence";
  created: number;
  /** Of `created`, stored in the aggregate entry rather than as cards. */
  aggregated: number;
  grown: number;
};

export type SuggestTripsOptions = {
  nowMs?: number;
  windowDays?: number;
  hooks?: { afterRead?: () => Promise<unknown> };
};

type Span = { id: string; fromDay: string; toDay: string };

const result = (
  status: SuggestTripsResult["status"],
  extra: Partial<SuggestTripsResult> = {}
): SuggestTripsResult => ({ status, created: 0, aggregated: 0, grown: 0, ...extra });

const overlaps = (a: { fromDay: string; toDay: string }, b: { fromDay: string; toDay: string }) =>
  a.fromDay <= b.toDay && b.fromDay <= a.toDay;

/** The account's trips with both ends known, as local days. */
async function tripSpans(userId: string): Promise<Span[]> {
  const trips = await prisma.trip.findMany({
    where: { userId },
    select: { id: true, startDay: true, endDay: true, startDate: true, endDate: true },
  });
  const day = (d: Date | null, anchor: Date | null) =>
    d ? fromDbDate(d) : anchor ? anchor.toISOString().slice(0, 10) : null;
  return trips.flatMap((t) => {
    const fromDay = day(t.startDay, t.startDate);
    const toDay = day(t.endDay, t.endDate);
    return fromDay && toDay && fromDay <= toDay ? [{ id: t.id, fromDay, toDay }] : [];
  });
}

/** Held already (null), or the trip to widen ("" for none: a new trip). */
export function logbookMatch(run: AwayRun, trips: readonly Span[]): string | null {
  const first = run.awayDays[0];
  const last = run.awayDays[run.awayDays.length - 1];
  if (trips.some((t) => t.fromDay <= first && last <= t.toDay)) return null;
  // Touching: overlapping, or adjacent by one day on either side.
  const touching = trips
    .filter((t) => overlaps({ fromDay: shiftDay(t.fromDay, -1), toDay: shiftDay(t.toDay, 1) }, run))
    .map((t) => ({ id: t.id, shared: sharedDays(t, run) }))
    .sort((a, b) => b.shared - a.shared || a.id.localeCompare(b.id));
  return touching[0]?.id ?? "";
}

function sharedDays(a: Span, b: { fromDay: string; toDay: string }): number {
  const from = a.fromDay > b.fromDay ? a.fromDay : b.fromDay;
  const to = a.toDay < b.toDay ? a.toDay : b.toDay;
  return from > to ? 0 : (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
}

const spanLength = (run: { fromDay: string; toDay: string }) =>
  Math.round((Date.parse(run.toDay) - Date.parse(run.fromDay)) / 86_400_000) + 1;

function evidenceOf(
  run: AwayRun,
  tripId: string | null,
  aggregated: boolean,
  coverage: TripEvidence["readCoverage"]
): TripEvidence {
  return {
    source: "travtrack",
    fromDay: run.fromDay,
    toDay: run.toDay,
    zone: run.zone,
    awayDays: run.awayDays,
    countries: run.countries,
    km: run.km,
    tripId,
    aggregated,
    readCoverage: coverage,
  };
}

/** A trip question's explanation: its code by whether it widens a trip, days, km. */
export function tripExplanation(evidence: TripEvidence) {
  const params: Record<string, number | string> = {
    days: spanLength(evidence),
    km: evidence.km,
  };
  if (evidence.tripId) params.tripId = evidence.tripId;
  return explanation(evidence.tripId ? "trip.extend" : "trip.away", params);
}

function columnsOf(evidence: TripEvidence) {
  return {
    windowFrom: startOfDayAt(evidence.fromDay, evidence.zone),
    windowUntil: startOfDayAt(shiftDay(evidence.toDay, 1), evidence.zone),
    explanation: tripExplanation(evidence),
    evidence: evidence as unknown as Prisma.InputJsonValue,
  };
}

/** The account's trip questions: by key, and the spans every answered or other one settles. */
async function existingQuestions(userId: string) {
  const rows = await prisma.locationSuggestion.findMany({
    where: { userId, kind: "trip" },
    select: { id: true, status: true, evidenceKey: true, evidence: true },
  });
  return rows.flatMap((r) => {
    const e = r.evidence as { fromDay?: unknown; toDay?: unknown } | null;
    if (typeof e?.fromDay !== "string" || typeof e.toDay !== "string") return [];
    return [{ ...r, fromDay: e.fromDay, toDay: e.toDay, full: parseTripEvidence(r.evidence) }];
  });
}

type Plan = {
  create: Prisma.LocationSuggestionCreateManyInput[];
  grow: Array<{ id: string; before: Prisma.InputJsonValue; data: ReturnType<typeof columnsOf> }>;
  aggregated: number;
};

async function plan(
  userId: string,
  runs: AwayRun[],
  coverage: TripEvidence["readCoverage"]
): Promise<Plan> {
  const [trips, existing, provider] = await Promise.all([
    tripSpans(userId),
    existingQuestions(userId),
    getLocationProvider(userId),
  ]);
  const fresh: Array<{ run: AwayRun; tripId: string | null }> = [];
  const grow: Plan["grow"] = [];
  for (const run of runs) {
    const match = logbookMatch(run, trips);
    if (match === null) continue;
    const tripId = match || null;
    const key = tripEvidenceKey(run.fromDay);
    const same = existing.find((q) => q.evidenceKey === key);
    if (same) {
      // A question asked about this run: it grows while pending, else it is settled.
      if (same.status !== "pending" || !same.full) continue;
      const next = evidenceOf(run, tripId, same.full.aggregated, coverage);
      if (JSON.stringify(next) !== JSON.stringify(same.full)) {
        grow.push({
          id: same.id,
          before: same.evidence as Prisma.InputJsonValue,
          data: columnsOf(next),
        });
      }
      continue;
    }
    if (existing.some((q) => overlaps(q, run))) continue;
    fresh.push({ run, tripId });
  }
  // The newest runs become cards; the older ones wait in the aggregate entry.
  const newestFirst = [...fresh].sort((a, b) => b.run.fromDay.localeCompare(a.run.fromDay));
  const create = newestFirst.map(({ run, tripId }, i) => ({
    userId,
    kind: "trip",
    provider: "travtrack",
    providerRev: provider.rev,
    algorithm: TRIP_ALGORITHM,
    evidenceKey: tripEvidenceKey(run.fromDay),
    ...columnsOf(evidenceOf(run, tripId, i >= MAX_NEW_TRIP_QUESTIONS, coverage)),
  }));
  return { create, grow, aggregated: Math.max(0, create.length - MAX_NEW_TRIP_QUESTIONS) };
}

export async function suggestTrips(
  userId: string,
  opts: SuggestTripsOptions = {}
): Promise<SuggestTripsResult> {
  const allowance = await travTrackDerivationAllowed(userId);
  if (allowance !== "ok") return result("skipped", { reason: allowance });

  const nowMs = opts.nowMs ?? now().getTime();
  // Finished days on the residence's clock, the one the days are classified on.
  const today = await homeToday(userId, nowMs);
  if (!today) return result("skipped", { reason: "noResidence" });
  const window = {
    fromDay: shiftDay(today, -(opts.windowDays ?? TRIP_WINDOW_DAYS)),
    untilDay: shiftDay(today, -1),
  };
  const read = await awayPeriods(userId, window, {
    isAllowed: async () => (await travTrackDerivationAllowed(userId)) === "ok",
  });
  if (read.status === "noResidence") return result("skipped", { reason: "noResidence" });
  if (read.status === "cancelled") return result("cancelled");
  await opts.hooks?.afterRead?.();

  const runs = read.runs.filter((r) => !r.openStart);
  const { create, grow, aggregated } = await plan(userId, runs, read.coverage);
  if (create.length === 0 && grow.length === 0) return result("done");

  const published = await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    if ((await historyGeneration(tx, userId)) !== read.generation) return "stale" as const;
    // Asked again under the lock: a switch while it read publishes nothing.
    const allowedNow = await travTrackDerivationAllowed(userId);
    if (allowedNow !== "ok") return allowedNow;
    const { count } = await tx.locationSuggestion.createMany({
      data: create,
      skipDuplicates: true,
    });
    let grown = 0;
    for (const g of grow) {
      // Only the row as read, and only while nobody answers it.
      const updated = await tx.locationSuggestion.updateMany({
        where: { id: g.id, userId, status: "pending", evidence: { equals: g.before } },
        data: g.data,
      });
      grown += updated.count;
    }
    return { created: count, grown };
  });
  if (published === "stale") {
    logger.info({ operation: "travtrack_trips_stale", userId });
    return result("stale");
  }
  if (typeof published === "string") return result("skipped", { reason: published });
  logger.info({ operation: "travtrack_trips_done", userId, ...published, aggregated });
  return result("done", { ...published, aggregated: published.created > 0 ? aggregated : 0 });
}
