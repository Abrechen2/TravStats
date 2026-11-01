import { prisma } from "../../../db";
import { midnightOf } from "../range";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { providerIs } from "../../locationProvider/provider";
import { loadEverydaySummary, type EverydaySummary } from "./load";
import { readSafeTravTrack, type SafeCursor } from "../readSafe";
import type { MotionClass } from "./plausible";

/**
 * The everyday figures as the API states them (forgejo#400): rounded, and
 * abstaining. `null` when TravTrack is not this account's working location
 * source (`providerIs` — chosen AND available, so a switched-off server or the
 * shared demo account reads nothing), or when the window holds no
 * privacy-safe fix.
 */

export type TravTrackYearStats = {
  kmGround: number | null;
  daysRecorded: number;
  topSpeedKmh: number | null;
  highestPointM: number | null;
  byMotion: { motion: MotionClass; hours: number; km: number }[];
};

const one = (n: number) => Math.round(n * 10) / 10;

export function everydayView(summary: EverydaySummary): TravTrackYearStats {
  const { figures } = summary;
  return {
    kmGround: summary.kmGround > 0 ? one(summary.kmGround) : null,
    daysRecorded: summary.days,
    topSpeedKmh: figures.topSpeed ? Math.round(figures.topSpeed.mps * 3.6) : null,
    highestPointM: figures.highest ? Math.round(figures.highest.m) : null,
    byMotion: (Object.entries(figures.byMotion) as [MotionClass, { ms: number; km: number }][])
      .filter(([, v]) => v.ms > 0)
      .map(([motion, v]) => ({ motion, hours: one(v.ms / 3_600_000), km: one(v.km) })),
  };
}

/** The calendar `year` on the account's profile clock, as instants `[from, to)`. */
export async function yearWindow(userId: string, year: number) {
  const { zone } = await profileZoneOf(userId);
  return {
    fromMs: midnightOf(`${String(year).padStart(4, "0")}-01-01`, zone).getTime(),
    untilMs: midnightOf(`${String(year + 1).padStart(4, "0")}-01-01`, zone).getTime(),
  };
}

export async function travTrackYearStats(
  userId: string,
  year: number
): Promise<TravTrackYearStats | null> {
  if (!(await providerIs(userId, "travtrack"))) return null;
  const summary = await loadEverydaySummary(userId, await yearWindow(userId, year));
  return summary ? everydayView(summary) : null;
}

const EXISTENCE_PAGE = 500;
const EXISTENCE_PAGES = 8;

/** Whether the window holds any privacy-safe fix; reads at most a few small pages. */
async function hasSafeFix(
  userId: string,
  window: { fromMs: number; untilMs: number }
): Promise<boolean> {
  let cursor: SafeCursor | null = null;
  for (let page = 0; page < EXISTENCE_PAGES; page++) {
    const read = await readSafeTravTrack(userId, window, EXISTENCE_PAGE, cursor);
    if (read.segments.some((stretch) => stretch.length > 0)) return true;
    if (!read.next || !read.cursor) return false;
    cursor = read.cursor;
  }
  // Many pages of points, all inside privacy zones: not worth a year in the picker.
  return false;
}

/**
 * The calendar years (profile zone) in which this account has privacy-safe
 * TravTrack figures, ascending — so an account that only records, with no
 * logbook entry in a year, still gets that year in its review (forgejo#400).
 * Candidates come from the stored points' years; each is then confirmed by a
 * bounded existence check over the privacy-safe read (`hasSafeFix`), because a
 * year whose every fix lies in a privacy zone has nothing to show — and the
 * full figures are not worth computing for every year on every request.
 * `skip` are years the caller already has.
 */
export async function travTrackYears(
  userId: string,
  skip: ReadonlySet<number> = new Set()
): Promise<number[]> {
  if (!(await providerIs(userId, "travtrack"))) return [];
  const { zone } = await profileZoneOf(userId);
  const rows = await prisma.$queryRaw<{ y: number }[]>`
    SELECT DISTINCT EXTRACT(YEAR FROM (t AT TIME ZONE 'UTC') AT TIME ZONE ${zone})::int AS y
    FROM travtrack_points WHERE user_id = ${userId}`;
  const out: number[] = [];
  for (const { y } of rows.sort((a, b) => a.y - b.y)) {
    if (skip.has(y)) continue;
    if (await hasSafeFix(userId, await yearWindow(userId, y))) out.push(y);
  }
  return out;
}
