/**
 * When the nights happened. Pure — no I/O, no Prisma.
 *
 * Every figure here works off the SET of dates the user slept away from home,
 * not off the stays. Two stays that touch (check out Friday, check in Friday)
 * are one continuous run away, and two stays that overlap — a booking changed
 * mid-trip, a second room — must not count a night twice. A set of dates gets
 * both right for free; iterating stays gets both wrong.
 */
import type { StayWithNights } from "./money";
import type { LodgingRhythmStats } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Meteorological seasons, northern hemisphere — the convention the UI labels. */
type Season = "winter" | "spring" | "summer" | "autumn";
const SEASON_BY_MONTH: readonly Season[] = [
  "winter", // Jan
  "winter",
  "spring",
  "spring",
  "spring",
  "summer",
  "summer",
  "summer",
  "autumn",
  "autumn",
  "autumn",
  "winter", // Dec
];

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

export function computeRhythmStats(
  entries: StayWithNights[],
  now: Date,
): LodgingRhythmStats {
  // Every date the user was away, deduplicated. Keyed by UTC midnight in ms so
  // consecutive-run detection is plain arithmetic.
  const nightDays = new Set<number>();

  for (const { stay, timing } of entries) {
    // Only a stay with two real dates has days to contribute. An undated one,
    // or one known only to the month, has no position on a calendar — placing
    // it on its placeholder would invent a weekday, and could bridge a gap
    // between two real runs that never touched.
    if (!timing.walkable || stay.checkIn === null || stay.checkOut === null) continue;
    let cursor = Date.UTC(
      stay.checkIn.getUTCFullYear(),
      stay.checkIn.getUTCMonth(),
      stay.checkIn.getUTCDate(),
    );
    const end = Date.UTC(
      stay.checkOut.getUTCFullYear(),
      stay.checkOut.getUTCMonth(),
      stay.checkOut.getUTCDate(),
    );
    while (cursor < end) {
      nightDays.add(cursor);
      cursor += DAY_MS;
    }
  }

  // 0 = Sunday, matching `Date.getUTCDay()`. The UI decides where its week
  // starts; re-basing here would mean two conventions for one array.
  const nightsByWeekday = [0, 0, 0, 0, 0, 0, 0];
  const nightsByMonthOfYear = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const nightsBySeason: Record<Season, number> = {
    winter: 0,
    spring: 0,
    summer: 0,
    autumn: 0,
  };
  const nightsPerYear: Record<string, number> = {};

  const sorted = [...nightDays].sort((a, b) => a - b);
  for (const ms of sorted) {
    const d = new Date(ms);
    nightsByWeekday[d.getUTCDay()] += 1;
    nightsByMonthOfYear[d.getUTCMonth()] += 1;
    nightsBySeason[SEASON_BY_MONTH[d.getUTCMonth()]] += 1;
    const year = String(d.getUTCFullYear());
    nightsPerYear[year] = (nightsPerYear[year] ?? 0) + 1;
  }

  // Longest unbroken run away, and the longest stretch at home between the
  // first and the last night away. The gap is bounded by those two dates on
  // purpose: before the first recorded night the user was not "at home for
  // 30 years", they simply had no data.
  let longestStreakNights = 0;
  let longestStreak: { start: string; end: string } | null = null;
  let longestGapDays = 0;
  let runStart = sorted.length > 0 ? sorted[0] : 0;
  let runLength = sorted.length > 0 ? 1 : 0;

  const closeRun = (endMs: number): void => {
    if (runLength > longestStreakNights) {
      longestStreakNights = runLength;
      longestStreak = { start: ymd(runStart), end: ymd(endMs) };
    }
  };

  for (let i = 1; i < sorted.length; i += 1) {
    const gap = (sorted[i] - sorted[i - 1]) / DAY_MS;
    if (gap === 1) {
      runLength += 1;
      continue;
    }
    closeRun(sorted[i - 1]);
    // `gap` counts the step between two nights away, so the nights AT HOME
    // between them is one fewer.
    if (gap - 1 > longestGapDays) longestGapDays = gap - 1;
    runStart = sorted[i];
    runLength = 1;
  }
  if (sorted.length > 0) closeRun(sorted[sorted.length - 1]);

  // Share of the year spent away. The CURRENT year is divided by the days
  // elapsed so far, not by 365 — otherwise every January reports a share that
  // can only ever look like a collapse against last year.
  const nowYear = now.getUTCFullYear();
  const startOfYear = Date.UTC(nowYear, 0, 1);
  const elapsedThisYear = Math.max(
    1,
    Math.floor((Date.UTC(nowYear, now.getUTCMonth(), now.getUTCDate()) - startOfYear) / DAY_MS) + 1,
  );
  const awayShareByYear: Record<string, number> = {};
  for (const [year, nights] of Object.entries(nightsPerYear)) {
    const denominator =
      Number(year) === nowYear ? elapsedThisYear : daysInYear(Number(year));
    awayShareByYear[year] = Math.round((nights / denominator) * 10000) / 10000;
  }

  return {
    nightsAway: nightDays.size,
    nightsByWeekday,
    nightsByMonthOfYear,
    nightsBySeason,
    longestStreakNights,
    longestStreak,
    longestGapDays,
    awayShareByYear,
  };
}
