import { Prisma } from "../../../prisma";
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import {
  deriveDaySource,
  profileDayWindow,
  requeueDownstream,
  type OutlierDecision,
} from "./store";
import type { Bridge, ClockOffset, SourceScore, SourceSegment } from "./types";

/**
 * What the user decides about a day's sources, and what the web shows of it:
 * the day view's source panel and the list "Tage mit fragwürdigen Spuren".
 * Every decision is reversible — `null` hands the day back to the automatic
 * resolution — and none of them touches a stored point.
 */

/** A best score under this lists the day as questionable. */
export const LOW_SCORE = 0.5;
/** The list's page. */
export const QUESTIONABLE_PAGE = 100;

export type SourceKind = "phone" | "dawarich" | "import" | "other";

/** What an origin is, for the copy: `companion:…` is the phone, `gpx:…` a file import. */
export function sourceKindOf(origin: string): SourceKind {
  const prefix = origin.split(":", 1)[0];
  if (prefix === "companion" || prefix === "owntracks" || prefix === "overland") return "phone";
  if (prefix === "dawarich") return "dawarich";
  if (["gpx", "kml", "tcx", "fit", "geojson", "timeline", "import"].includes(prefix))
    return "import";
  return "other";
}

export type DaySourceSummary = {
  scored: boolean;
  sources: Array<{
    source: string;
    kind: SourceKind;
    score: number;
    points: number;
    accuracyKnownShare: number;
  }>;
  segments: SourceSegment[];
  override: string | null;
  mixed: boolean;
  bestScore: number | null;
  outliers: { count: number; decision: OutlierDecision | null };
  bridges: Bridge[];
  /** Unsupported jumps no line is drawn across (empty while the user keeps outliers). */
  breaks: Array<[number, number]>;
  clockOffset: ClockOffset | null;
  truncated: boolean;
  questionable: boolean;
};

type Row = NonNullable<Awaited<ReturnType<typeof prisma.travTrackDaySource.findUnique>>>;

const isQuestionable = (
  r: Pick<Row, "bestScore" | "mixed" | "outlierCount" | "overrideSource" | "outlierDecision">
) =>
  (r.overrideSource === null && (r.mixed || r.bestScore < LOW_SCORE)) ||
  (r.outlierCount > 0 && r.outlierDecision === null);

export function summaryOf(row: Row | null): DaySourceSummary {
  if (!row) {
    return {
      scored: false,
      sources: [],
      segments: [],
      override: null,
      mixed: false,
      bestScore: null,
      outliers: { count: 0, decision: null },
      bridges: [],
      breaks: [],
      clockOffset: null,
      truncated: false,
      questionable: false,
    };
  }
  return {
    scored: true,
    sources: (row.scores as SourceScore[]).map((s) => ({
      source: s.source,
      kind: sourceKindOf(s.source),
      score: s.score,
      points: s.signals.points,
      accuracyKnownShare: s.signals.accuracyKnownShare,
    })),
    segments: row.segments as SourceSegment[],
    override: row.overrideSource,
    mixed: row.mixed,
    bestScore: row.bestScore,
    outliers: {
      count: row.outlierCount,
      decision: (row.outlierDecision as OutlierDecision | null) ?? null,
    },
    bridges: row.bridges as Bridge[],
    breaks: row.outlierDecision === "keep" ? [] : (row.breaks as Array<[number, number]>),
    clockOffset: (row.clockOffset as ClockOffset | null) ?? null,
    truncated: row.truncated,
    questionable: isQuestionable(row),
  };
}

const dayKey = (day: string) => new Date(`${day}T00:00:00.000Z`);

export async function daySourceSummary(userId: string, day: string): Promise<DaySourceSummary> {
  return summaryOf(
    await prisma.travTrackDaySource.findUnique({
      where: { userId_day: { userId, day: dayKey(day) } },
    })
  );
}

/**
 * Stores the user's choice for one day and re-derives that day — and only
 * that day. `undefined` leaves a field as it is; `null` resets it to automatic.
 */
export async function setDaySourceChoice(
  userId: string,
  day: string,
  choice: { overrideSource?: string | null; outlierDecision?: OutlierDecision | null }
): Promise<DaySourceSummary> {
  if (choice.overrideSource) {
    const w = await profileDayWindow(userId, day);
    const holds = await prisma.travTrackPoint.findFirst({
      where: {
        userId,
        origin: choice.overrideSource,
        t: { gte: new Date(w.fromMs), lt: new Date(w.untilMs) },
      },
      select: { id: true },
    });
    if (!holds) {
      throw new AppError(
        "That source holds no points on the day",
        400,
        "TRAVTRACK_SOURCE_NOT_ON_DAY"
      );
    }
  }
  // The row must exist to carry the choice: a day the paced run has not reached is resolved now.
  let row = await prisma.travTrackDaySource.findUnique({
    where: { userId_day: { userId, day: dayKey(day) } },
  });
  if (!row) {
    await deriveDaySource(userId, day);
    row = await prisma.travTrackDaySource.findUnique({
      where: { userId_day: { userId, day: dayKey(day) } },
    });
  }
  if (!row) throw new AppError("The day holds no points", 404, "TRAVTRACK_DAY_NO_POINTS");
  await prisma.travTrackDaySource.update({
    where: { userId_day: { userId, day: dayKey(day) } },
    data: {
      ...(choice.overrideSource !== undefined ? { overrideSource: choice.overrideSource } : {}),
      ...(choice.outlierDecision !== undefined ? { outlierDecision: choice.outlierDecision } : {}),
    },
  });
  await deriveDaySource(userId, day);
  if (choice.outlierDecision !== undefined) {
    // Keeping or discarding outliers changes what a read keeps without changing the derivation.
    await requeueDownstream(userId, await profileDayWindow(userId, day));
  }
  return daySourceSummary(userId, day);
}

export type QuestionableDay = {
  date: string;
  reasons: Array<"lowScore" | "mixed" | "outliers">;
  bestScore: number;
  outlierCount: number;
  sources: string[];
};

const QUESTIONABLE_WHERE = (userId: string) => Prisma.sql`
  user_id = ${userId} AND (
    (override_source IS NULL AND (mixed OR best_score < ${LOW_SCORE}))
    OR (outlier_count > 0 AND outlier_decision IS NULL))`;

/** The days with a low score, mixed sources or open outliers, newest first. */
export async function questionableDays(
  userId: string,
  page = 0
): Promise<{ total: number; days: QuestionableDay[] }> {
  const [[{ n }], rows] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS n FROM travtrack_day_sources WHERE ${QUESTIONABLE_WHERE(userId)}`),
    prisma.$queryRaw<
      Array<{
        day: Date;
        best_score: number;
        mixed: boolean;
        outlier_count: number;
        override_source: string | null;
        outlier_decision: string | null;
        scores: SourceScore[];
      }>
    >(Prisma.sql`
      SELECT day, best_score, mixed, outlier_count, override_source, outlier_decision, scores
        FROM travtrack_day_sources WHERE ${QUESTIONABLE_WHERE(userId)}
       ORDER BY day DESC LIMIT ${QUESTIONABLE_PAGE} OFFSET ${page * QUESTIONABLE_PAGE}`),
  ]);
  return {
    total: Number(n),
    days: rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      reasons: [
        ...(r.override_source === null && r.best_score < LOW_SCORE ? (["lowScore"] as const) : []),
        ...(r.override_source === null && r.mixed ? (["mixed"] as const) : []),
        ...(r.outlier_count > 0 && r.outlier_decision === null ? (["outliers"] as const) : []),
      ],
      bestScore: r.best_score,
      outlierCount: r.outlier_count,
      sources: r.scores.map((s) => s.source),
    })),
  };
}

/** How many questionable days the account holds: the readiness count. */
export async function questionableDayCount(userId: string): Promise<number> {
  const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT count(*)::bigint AS n FROM travtrack_day_sources WHERE ${QUESTIONABLE_WHERE(userId)}`);
  return Number(n);
}

/**
 * What deleting `[from, to)` would remove, before anything is removed: points
 * per profile day and source. The delete itself stays `DELETE /travtrack/points`.
 */
export async function deleteRangePreview(
  userId: string,
  from: Date,
  to: Date,
  zone: string
): Promise<{
  points: number;
  days: Array<{ date: string; points: number; sources: Record<string, number> }>;
}> {
  const rows = await prisma.$queryRaw<{ day: Date; origin: string; n: bigint }[]>(Prisma.sql`
    SELECT ((t AT TIME ZONE 'UTC') AT TIME ZONE ${zone})::date AS day, origin, count(*)::bigint AS n
      FROM travtrack_points
     WHERE user_id = ${userId} AND t >= ${from} AND t < ${to}
     GROUP BY 1, 2 ORDER BY 1`);
  const byDay = new Map<
    string,
    { date: string; points: number; sources: Record<string, number> }
  >();
  for (const r of rows) {
    const date = r.day.toISOString().slice(0, 10);
    const d = byDay.get(date) ?? { date, points: 0, sources: {} };
    d.points += Number(r.n);
    d.sources[r.origin] = Number(r.n);
    byDay.set(date, d);
  }
  const days = [...byDay.values()];
  return { points: days.reduce((n, d) => n + d.points, 0), days };
}
