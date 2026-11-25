import { Prisma } from "../../../prisma";
import { prisma, type DbTransaction } from "../../../db";
import { localDay } from "../../../shared/time/instant";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { inPrivacyZone } from "../classify";
import { ackDirtyDay, pendingDirtyDays, SOURCES_BIT, utcDayOf } from "../dirtyDays";
import { noPace, type Pace } from "../imports/importPacing";
import { privacyCirclesFor } from "../privacyCircles";
import { dayAfter, midnightOf } from "../range";
import { travelEntriesIn } from "./entries";
import { resolveDay, type ReadResolution } from "./resolveDay";
import type { Bridge, DayResolution, SourcePoint, SourceSegment, Window } from "./types";

/**
 * Where a day's resolution lives (`travtrack_day_sources`) and how it is kept
 * current. Derived one profile-local day at a time, never for a span: a day's
 * read is bounded (`DAY_SOURCE_CAP`), and an override re-derives only its day.
 * The paced projection drives it on its own dirty-day bit (`SOURCES_BIT`);
 * a day whose resolution changed hands its other projections (country days,
 * explored map, months, visits) back to the queue, so they read the new stream.
 */

/** At most this many points of one day are scored; more marks the row `truncated`. */
export const DAY_SOURCE_CAP = 50_000;
/** Days one projection run resolves at most. */
export const SOURCE_DAYS_PER_RUN = 60;

export const OUTLIER_DECISIONS = ["discard", "keep"] as const;
export type OutlierDecision = (typeof OUTLIER_DECISIONS)[number];

export type DayWindow = Window & { day: string; zone: string };

export async function profileDayWindow(userId: string, day: string): Promise<DayWindow> {
  const { zone } = await profileZoneOf(userId);
  return {
    day,
    zone,
    fromMs: midnightOf(day, zone).getTime(),
    untilMs: midnightOf(dayAfter(day), zone).getTime(),
  };
}

/** The day's points of every origin, privacy zones first (design point 7), time-ordered. */
async function dayPoints(userId: string, w: Window) {
  const [rows, circles] = await Promise.all([
    prisma.travTrackPoint.findMany({
      where: { userId, t: { gte: new Date(w.fromMs), lt: new Date(w.untilMs) } },
      orderBy: [{ t: "asc" }, { seq: "asc" }],
      take: DAY_SOURCE_CAP + 1,
      select: { id: true, t: true, lat: true, lon: true, accuracyM: true, origin: true },
    }),
    privacyCirclesFor(userId, w.fromMs),
  ]);
  const points: SourcePoint[] = rows
    .slice(0, DAY_SOURCE_CAP)
    .filter((r) => !inPrivacyZone(r, circles))
    .map((r) => ({ ...r, tMs: r.t.getTime() }));
  return { points, truncated: rows.length > DAY_SOURCE_CAP };
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** The UTC days `[fromMs, untilMs)` touches: the dirty-day protocol's keys. */
function utcDaysOfWindow(w: Window): string[] {
  const days: string[] = [];
  for (let d = utcDayOf(w.fromMs); d <= utcDayOf(w.untilMs - 1);) {
    days.push(d);
    d = utcDayOf(Date.parse(`${d}T00:00:00.000Z`) + 86_400_000);
  }
  return days;
}

/**
 * Hands the day's other projections back to the queue without raising its
 * version: the points did not change, the stream they read did.
 */
export async function requeueDownstream(
  userId: string,
  w: Window,
  db: Pick<DbTransaction, "$executeRaw"> = prisma
): Promise<void> {
  const days = utcDaysOfWindow(w);
  await db.$executeRaw`
    INSERT INTO travtrack_dirty_days (user_id, day, version, done)
    SELECT ${userId}, d::date, 1, ${SOURCES_BIT} FROM unnest(${days}::text[]) AS d
    ON CONFLICT (user_id, day) DO UPDATE SET done = travtrack_dirty_days.done & ${SOURCES_BIT}`;
}

/**
 * What a read does with a resolution: nothing for a day with one source and
 * no judged step (the same rows pass as without it), else its verdicts. Only
 * a change of this hands the day's projections back — the first pass over a
 * history of single-source days requeues nothing.
 */
function readEffect(r: {
  mixed: boolean;
  segments: unknown;
  outlierIds: unknown;
  breaks: unknown;
  bridges: unknown;
}): string | null {
  const judged = [r.outlierIds, r.breaks, r.bridges].some((v) => (v as unknown[]).length > 0);
  return r.mixed || judged ? JSON.stringify([r.segments, r.outlierIds, r.breaks, r.bridges]) : null;
}

/**
 * Resolves one profile day and stores it, keeping the user's own choices.
 * Returns whether what a read keeps changed (and so the downstream projections
 * were requeued). A day without points loses its row.
 */
export async function deriveDaySource(
  userId: string,
  day: string
): Promise<{ changed: boolean; resolution: DayResolution | null }> {
  const w = await profileDayWindow(userId, day);
  const dayDate = new Date(`${day}T00:00:00.000Z`);
  const [{ points, truncated }, entries, previous] = await Promise.all([
    dayPoints(userId, w),
    travelEntriesIn(userId, w),
    prisma.travTrackDaySource.findUnique({ where: { userId_day: { userId, day: dayDate } } }),
  ]);
  if (points.length === 0) {
    if (!previous) return { changed: false, resolution: null };
    const changed = readEffect(previous) !== null;
    await prisma.$transaction(async (tx) => {
      await tx.travTrackDaySource.delete({ where: { userId_day: { userId, day: dayDate } } });
      if (changed) await requeueDownstream(userId, w, tx);
    });
    return { changed, resolution: null };
  }
  const override =
    previous?.overrideSource && points.some((p) => p.origin === previous.overrideSource)
      ? previous.overrideSource
      : null;
  const r = resolveDay({ window: w, points, entries, override });
  const derived = {
    zone: w.zone,
    fromAt: new Date(w.fromMs),
    untilAt: new Date(w.untilMs),
    segments: json(r.segments),
    scores: json(r.scores),
    outlierIds: json(r.outlierIds),
    outlierCount: r.outlierIds.length + r.breaks.length,
    breaks: json(r.breaks),
    bridges: json(r.bridges),
    mixed: r.mixed,
    bestScore: r.bestScore,
    clockOffset: r.clockOffset ? json(r.clockOffset) : Prisma.JsonNull,
    truncated,
    derivedAt: new Date(),
  };
  const changed = (previous ? readEffect(previous) : null) !== readEffect(r);
  // One transaction: a stored change whose requeue failed would look settled to the next run.
  await prisma.$transaction(async (tx) => {
    await tx.travTrackDaySource.upsert({
      where: { userId_day: { userId, day: dayDate } },
      create: { userId, day: dayDate, ...derived },
      update: { ...derived, overrideSource: override },
    });
    if (changed) await requeueDownstream(userId, w, tx);
  });
  return { changed, resolution: r };
}

/** The profile days a UTC day touches (one or two). */
function profileDaysOfUtcDay(utcDay: string, zone: string): string[] {
  const from = Date.parse(`${utcDay}T00:00:00.000Z`);
  const first = localDay(new Date(from), zone);
  const last = localDay(new Date(from + 86_400_000 - 1), zone);
  return first === last ? [first] : [first, last];
}

/**
 * One paced run: up to `maxDays` UTC days pending on `SOURCES_BIT`, each
 * resolved through the profile days it touches, then acknowledged for the
 * version that was read.
 */
export async function projectDaySources(
  userId: string,
  { maxDays = SOURCE_DAYS_PER_RUN, pace = noPace }: { maxDays?: number; pace?: Pace } = {}
): Promise<{ days: number; changed: number }> {
  if (maxDays <= 0) return { days: 0, changed: 0 };
  const pending = await pendingDirtyDays(userId, SOURCES_BIT, maxDays);
  if (pending.length === 0) return { days: 0, changed: 0 };
  const { zone } = await profileZoneOf(userId);
  const done = new Set<string>();
  let changed = 0;
  for (const dirty of pending) {
    for (const day of profileDaysOfUtcDay(dirty.day, zone)) {
      if (done.has(day)) continue;
      done.add(day);
      // Paced like the other derivation steps, so a big import's backlog leaves the database
      // room for web requests (fix/travtrack-import-throttle).
      if ((await pace(() => deriveDaySource(userId, day))).changed) changed++;
    }
    await prisma.$transaction((tx) => ackDirtyDay(tx, userId, dirty, SOURCES_BIT));
  }
  return { days: pending.length, changed };
}

type StoredRow = {
  scores: unknown;
  fromAt: Date;
  untilAt: Date;
  segments: unknown;
  outlierIds: unknown;
  breaks: unknown;
  bridges: unknown;
  overrideSource: string | null;
  outlierDecision: string | null;
};

export function readResolutionOf(row: StoredRow): ReadResolution {
  const bridges = (row.bridges as Bridge[]).map((b): [number, number] => [b.fromMs, b.untilMs]);
  return {
    fromMs: row.fromAt.getTime(),
    untilMs: row.untilAt.getTime(),
    segments: row.segments as SourceSegment[],
    override: row.overrideSource,
    known: new Set((row.scores as Array<{ source: string }>).map((s) => s.source)),
    outlierIds: new Set(row.outlierDecision === "keep" ? [] : (row.outlierIds as string[])),
    breaks: row.outlierDecision === "keep" ? [] : (row.breaks as Array<[number, number]>),
    bridges,
  };
}

/** The resolutions of the days overlapping `window`: what a bounded read filters by. */
export async function readResolutionsIn(userId: string, w: Window): Promise<ReadResolution[]> {
  const rows = await prisma.travTrackDaySource.findMany({
    where: { userId, fromAt: { lt: new Date(w.untilMs) }, untilAt: { gt: new Date(w.fromMs) } },
    select: {
      scores: true,
      fromAt: true,
      untilAt: true,
      segments: true,
      outlierIds: true,
      breaks: true,
      bridges: true,
      overrideSource: true,
      outlierDecision: true,
    },
  });
  return rows.map(readResolutionOf);
}
