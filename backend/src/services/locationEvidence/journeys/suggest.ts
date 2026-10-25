/**
 * Missing journeys (TravTrack plan E7): movement TravTrack saw that the
 * logbook does not hold becomes a question in the inbox — "Du warst unterwegs;
 * war das eine Zugfahrt, eine Busfahrt, ein Roadtrip?". TravStats code: it
 * reads TravTrack through E2 and writes `location_suggestions` rows only; the
 * entries are made by the user, through the TravStats forms.
 *
 * Runs only while the instance's TravTrack is on and the account's provider is
 * `travtrack` (`travTrackDerivationAllowed`) — never for Dawarich (open owner
 * decision (c)) — and only for an account that has at least one of the
 * domains an answer can be (rail, bus, roadtrip).
 *
 * Bounded (review focus 19): it reads the last `JOURNEY_WINDOW_DAYS` finished
 * local days (today is not asked about until it is over), asks ONE question
 * per day — the day's uncovered runs listed inside it — and at most
 * `MAX_NEW_JOURNEY_QUESTIONS` new per run, oldest first; the rest wait. A day
 * that has a question already is settled, whatever its answer: a rejected day
 * is never asked again, and a day being answered is not asked twice.
 *
 * Published under the TravTrack lock with the history generation the read
 * captured (E5's fence): a removal that landed while it read publishes
 * nothing (`stale`; the next run reads afresh), and TravTrack switched off or
 * a provider switch meanwhile publishes nothing either.
 */
import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { AVAILABLE_DOMAINS } from "../../../shared/domains";
import { localDay } from "../../../shared/time/instant";
import { now } from "../../../shared/time/clock";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { zoneOfCoordinates } from "../../../shared/time/resolveInput";
import logger from "../../../utils/logger";
import { loadVisibleDomains } from "../../domainVisibility";
import { getLocationProvider } from "../../locationProvider/provider";
import { privacyCirclesFor } from "../../travtrack/privacyCircles";
import { takeTravTrackLock } from "../../travtrack/lock";
import { travTrackDerivationAllowed, type DerivationAllowance } from "../allowed";
import { readTravTrackDerivation } from "../derivationRead";
import { explanation } from "../envelope";
import { historyGeneration } from "../generation";
import { journeyEvidenceKey } from "../key";
import { coveringWindow, logbookWindows } from "./entryWindows";
import {
  JOURNEY_ENTRY_KINDS,
  capDigests,
  linkedRefs,
  parseJourneyEvidence,
  type JourneyEvidence,
  type StoredJourneyRun,
} from "./evidence";
import { movementRuns, type MovementRun } from "./segment";

/** The journey detector's version (`location_suggestions.algorithm`). */
export const JOURNEY_ALGORITHM = 1;
export const JOURNEY_WINDOW_DAYS = 7;
export const MAX_NEW_JOURNEY_QUESTIONS = 7;

const DAY_MS = 86_400_000;

export type SuggestJourneysResult = {
  status: "done" | "skipped" | "stale" | "cancelled";
  reason?: Exclude<DerivationAllowance, "ok"> | "noJourneyDomains";
  created: number;
  /** Days with a question still to ask, held back by the per-run cap. */
  deferred: number;
  truncated: boolean;
};

export type SuggestJourneysOptions = {
  /** "Now"; the clock's unless a test pins it. */
  nowMs?: number;
  /** Finished local days to look back over. */
  windowDays?: number;
  hooks?: { afterRead?: () => Promise<unknown> };
};

type DayQuestion = { day: string; zone: string; runs: Array<MovementRun & { zones: Zones }> };
type Zones = { startZone: string; endZone: string };

const result = (
  status: SuggestJourneysResult["status"],
  extra: Partial<SuggestJourneysResult> = {}
): SuggestJourneysResult => ({ status, created: 0, deferred: 0, truncated: false, ...extra });

/** Whether this account has a domain a journey can be answered with. */
async function hasJourneyDomain(userId: string): Promise<boolean> {
  const visible = await loadVisibleDomains(userId);
  return JOURNEY_ENTRY_KINDS.some((k) => visible.includes(k) && AVAILABLE_DOMAINS.includes(k));
}

function storedRun(run: MovementRun & { zones: Zones }): StoredJourneyRun {
  return {
    fromMs: run.fromMs,
    untilMs: run.untilMs,
    km: run.km,
    start: run.start,
    end: run.end,
    startRecorded: run.startRecorded,
    endRecorded: run.endRecorded,
    startZone: run.zones.startZone,
    endZone: run.zones.endZone,
    line: run.line,
    modeHint: run.modeHint,
    pointCount: run.pointCount,
    pointDigests: capDigests(run.digests),
    state: "open",
    link: null,
  };
}

function rowOf(userId: string, rev: number, coverage: JourneyEvidence["readCoverage"]) {
  return (q: DayQuestion): Prisma.LocationSuggestionCreateManyInput => {
    const runs = q.runs.map(storedRun);
    const km = Math.round(runs.reduce((n, r) => n + r.km, 0));
    const evidence: JourneyEvidence = {
      source: "travtrack",
      day: q.day,
      zone: q.zone,
      readCoverage: coverage,
      runs,
    };
    return {
      userId,
      kind: "journey",
      provider: "travtrack",
      providerRev: rev,
      algorithm: JOURNEY_ALGORITHM,
      evidenceKey: journeyEvidenceKey(q.day, q.runs[0].firstKey),
      windowFrom: new Date(runs[0].fromMs),
      windowUntil: new Date(runs[runs.length - 1].untilMs + 1),
      explanation: explanation("journey.unlogged", { runs: runs.length, km }),
      evidence: evidence as unknown as Prisma.InputJsonValue,
    };
  };
}

/** The account's journey questions near the window: the days they settle, the entries they hold. */
async function existingQuestions(userId: string, fromMs: number) {
  const rows = await prisma.locationSuggestion.findMany({
    where: { userId, kind: "journey", windowUntil: { gte: new Date(fromMs - DAY_MS) } },
    select: { evidence: true },
  });
  const settled = new Set<string>();
  const own = new Set<string>();
  for (const row of rows) {
    const evidence = parseJourneyEvidence(row.evidence);
    if (!evidence) continue;
    settled.add(evidence.day);
    for (const ref of linkedRefs(evidence)) own.add(ref);
  }
  return { settled, own };
}

export async function suggestJourneys(
  userId: string,
  opts: SuggestJourneysOptions = {}
): Promise<SuggestJourneysResult> {
  const allowance = await travTrackDerivationAllowed(userId);
  if (allowance !== "ok") return result("skipped", { reason: allowance });
  if (!(await hasJourneyDomain(userId))) return result("skipped", { reason: "noJourneyDomains" });

  const nowMs = opts.nowMs ?? now().getTime();
  const windowDays = opts.windowDays ?? JOURNEY_WINDOW_DAYS;
  // One day more than is asked about, so the first day's runs have a start to be judged by.
  const window = { fromMs: nowMs - (windowDays + 1) * DAY_MS, untilMs: nowMs };
  const read = await readTravTrackDerivation(userId, window, {
    isAllowed: async () => (await travTrackDerivationAllowed(userId)) === "ok",
  });
  if (read.cancelled) return result("cancelled");
  await opts.hooks?.afterRead?.();

  const truncated = read.coverage !== "complete";
  const lastRead = read.points[read.points.length - 1]?.atMs ?? window.fromMs;
  const [circles, profile, windows, existing, provider] = await Promise.all([
    privacyCirclesFor(userId, window.fromMs),
    profileZoneOf(userId),
    logbookWindows(userId, window),
    existingQuestions(userId, window.fromMs),
    getLocationProvider(userId),
  ]);
  const runs = movementRuns(read.points, {
    readFromMs: window.fromMs,
    // A truncated read ends at its last point: a run still going there is not judged.
    readUntilMs: truncated ? lastRead : window.untilMs,
    circles,
  });

  const byDay = new Map<string, DayQuestion>();
  for (const run of runs) {
    const startZone = zoneOfCoordinates(run.start.lat, run.start.lon) ?? profile.zone;
    const endZone = zoneOfCoordinates(run.end.lat, run.end.lon) ?? profile.zone;
    const day = localDay(new Date(run.fromMs), startZone);
    const today = localDay(new Date(nowMs), startZone);
    const first = localDay(new Date(nowMs - windowDays * DAY_MS), startZone);
    if (day >= today || day < first || existing.settled.has(day)) continue;
    if (coveringWindow(run, windows, existing.own)) continue;
    const question = byDay.get(day) ?? { day, zone: startZone, runs: [] };
    question.runs.push({ ...run, zones: { startZone, endZone } });
    byDay.set(day, question);
  }
  const questions = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const ask = questions.slice(0, MAX_NEW_JOURNEY_QUESTIONS);
  const deferred = questions.length - ask.length;
  if (ask.length === 0) return result("done", { truncated, deferred });

  const data = ask.map(rowOf(userId, provider.rev, read.coverage));
  const published = await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    if ((await historyGeneration(tx, userId)) !== read.generation) return "stale" as const;
    // Asked again under the lock: a switch while it read publishes nothing.
    const allowedNow = await travTrackDerivationAllowed(userId);
    if (allowedNow !== "ok") return allowedNow;
    const { count } = await tx.locationSuggestion.createMany({ data, skipDuplicates: true });
    await tx.travTrackDerivationState.upsert({
      where: { userId },
      create: { userId, journeyAlgorithm: JOURNEY_ALGORITHM },
      update: { journeyAlgorithm: JOURNEY_ALGORITHM },
    });
    return count;
  });
  if (published === "stale") {
    logger.info({ operation: "travtrack_journeys_stale", userId });
    return result("stale", { truncated });
  }
  if (typeof published === "string") return result("skipped", { reason: published, truncated });
  logger.info({ operation: "travtrack_journeys_done", userId, created: published, deferred });
  return result("done", { created: published, deferred, truncated });
}
