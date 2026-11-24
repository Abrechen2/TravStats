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
 * the run goes on; an answered one (accepted, invalidated) is never asked
 * again, nor is a run that overlaps it. A REJECTED one is asked once more,
 * flagged `expanded` ("erweitert"), when the shared rejection memory says the
 * run has grown past double the rejected days and the quiet period is over
 * (trip suggestions v2, `tripSuggestions/rejectionMemory.ts`) — the rejected
 * row itself is reopened when the run keeps its first day.
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
import { readSuggestionSwitches, tripSuggestionsEnabled } from "../../settings/suggestionSwitches";
import { resolveHome } from "../../tripSuggestions/context";
import { loadAnswered } from "../../tripSuggestions/engine";
import { spanDecisions } from "../../tripSuggestions/proposals";
import { clampQuietDays, homeSignature, judgeSpan } from "../../tripSuggestions/rejectionMemory";
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
  reason?: Exclude<DerivationAllowance, "ok"> | "noResidence" | "tripSuggestionsOff";
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
  coverage: TripEvidence["readCoverage"],
  expanded = false
): TripEvidence {
  return {
    ...(expanded ? { expanded: true } : {}),
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
  /** Rejected rows asked once more over their grown run (`expanded`). */
  reopen: Array<{ id: string; data: ReturnType<typeof columnsOf> }>;
  grow: Array<{ id: string; before: Prisma.InputJsonValue; data: ReturnType<typeof columnsOf> }>;
  aggregated: number;
};

/** The shared rejection memory, as the sweep asks it: may this run be re-asked as expanded? */
async function expandedJudge(userId: string, today: string) {
  const [answered, switches, home] = await Promise.all([
    loadAnswered(userId),
    readSuggestionSwitches(userId),
    resolveHome(userId),
  ]);
  const decisions = [...spanDecisions(answered, []).values()];
  const quietDays = clampQuietDays(switches.tripSuggestionQuietDays);
  return (run: AwayRun) =>
    judgeSpan(
      {
        family: "trip",
        targetId: null,
        startDay: run.fromDay,
        endDay: run.toDay,
        homeSignature: homeSignature(home.homeAt(run.fromDay)),
      },
      decisions,
      today,
      quietDays
    ) === "expanded";
}

const OPEN = new Set(["pending", "accepting"]);

async function plan(
  userId: string,
  runs: AwayRun[],
  coverage: TripEvidence["readCoverage"],
  today: string
): Promise<Plan> {
  const [trips, existing, provider, mayExpand] = await Promise.all([
    tripSpans(userId),
    existingQuestions(userId),
    getLocationProvider(userId),
    expandedJudge(userId, today),
  ]);
  const fresh: Array<{ run: AwayRun; tripId: string | null }> = [];
  const grow: Plan["grow"] = [];
  const reopen: Plan["reopen"] = [];
  const expandedFresh: Array<{ run: AwayRun; tripId: string | null }> = [];
  for (const run of runs) {
    const match = logbookMatch(run, trips);
    if (match === null) continue;
    const tripId = match || null;
    const key = tripEvidenceKey(run.fromDay);
    const same = existing.find((q) => q.evidenceKey === key);
    const answered = existing.filter((q) => !OPEN.has(q.status) && overlaps(q, run));
    if (answered.length > 0 && !(same && OPEN.has(same.status))) {
      // Settled — unless every answer over it was a rejection, no other
      // question is open over it, and the memory lets it back as expanded.
      const openElsewhere = existing.some((q) => OPEN.has(q.status) && overlaps(q, run));
      const rejectedOnly = answered.every((q) => q.status === "rejected");
      if (openElsewhere || !rejectedOnly || !mayExpand(run)) continue;
      if (same) {
        reopen.push({
          id: same.id,
          data: columnsOf(evidenceOf(run, tripId, false, coverage, true)),
        });
      } else expandedFresh.push({ run, tripId });
      continue;
    }
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
  const expandedCreate = expandedFresh.map(({ run, tripId }) => ({
    userId,
    kind: "trip",
    provider: "travtrack",
    providerRev: provider.rev,
    algorithm: TRIP_ALGORITHM,
    evidenceKey: tripEvidenceKey(run.fromDay),
    ...columnsOf(evidenceOf(run, tripId, false, coverage, true)),
  }));
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
  return {
    create: [...create, ...expandedCreate],
    reopen,
    grow,
    aggregated: Math.max(0, create.length - MAX_NEW_TRIP_QUESTIONS),
  };
}

export async function suggestTrips(
  userId: string,
  opts: SuggestTripsOptions = {}
): Promise<SuggestTripsResult> {
  const allowance = await travTrackDerivationAllowed(userId);
  if (allowance !== "ok") return result("skipped", { reason: allowance });
  // The account's trip-suggestion switch is the one gate for every trip
  // question, the engine's and TravTrack's (trip suggestions v2): off, the
  // sweep produces nothing.
  if (!(await tripSuggestionsEnabled(userId))) {
    return result("skipped", { reason: "tripSuggestionsOff" });
  }

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
  const { create, reopen, grow, aggregated } = await plan(userId, runs, read.coverage, today);
  if (create.length === 0 && grow.length === 0 && reopen.length === 0) return result("done");

  const published = await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    if ((await historyGeneration(tx, userId)) !== read.generation) return "stale" as const;
    // Asked again under the lock: a switch while it read publishes nothing.
    const allowedNow = await travTrackDerivationAllowed(userId);
    if (allowedNow !== "ok") return allowedNow;
    if (!(await tripSuggestionsEnabled(userId))) return "tripSuggestionsOff" as const;
    const { count } = await tx.locationSuggestion.createMany({
      data: create,
      skipDuplicates: true,
    });
    let reopened = 0;
    for (const r of reopen) {
      // Only while it is still the rejection the plan read.
      const updated = await tx.locationSuggestion.updateMany({
        where: { id: r.id, userId, status: "rejected" },
        data: { ...r.data, status: "pending", resolvedAt: null, claimToken: null, claimedAt: null },
      });
      reopened += updated.count;
    }
    let grown = 0;
    for (const g of grow) {
      // Only the row as read, and only while nobody answers it.
      const updated = await tx.locationSuggestion.updateMany({
        where: { id: g.id, userId, status: "pending", evidence: { equals: g.before } },
        data: g.data,
      });
      grown += updated.count;
    }
    return { created: count + reopened, grown };
  });
  if (published === "stale") {
    logger.info({ operation: "travtrack_trips_stale", userId });
    return result("stale");
  }
  if (typeof published === "string") return result("skipped", { reason: published });
  logger.info({ operation: "travtrack_trips_done", userId, ...published, aggregated });
  return result("done", { ...published, aggregated: published.created > 0 ? aggregated : 0 });
}
