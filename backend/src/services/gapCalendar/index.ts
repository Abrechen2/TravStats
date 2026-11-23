import { prisma } from "../../db";
import { profileZoneFromSettings } from "../../shared/time/profileZone";
import { now, todayIn } from "../../shared/time/clock";
import { homePeriodsFromData } from "../home/homeStore";
import { cacheGet, cachePut, currentGeneration, ensureCacheInvalidation } from "./cache";
import {
  classifyDay,
  countStates,
  isInferredHome,
  toRuns,
  type DayRun,
  type DayState,
} from "./classify";
import { gapCalendarFacts } from "./query";

export interface GapCalendarYear {
  year: number;
  zone: string;
  today: string;
  firstDay: string | null;
  /** Years from the first record to today, oldest first; empty when nothing is recorded. */
  years: number[];
  counts: Record<DayState, number>;
  /** Inclusive runs of one state, in order, covering every day of `year`. */
  runs: DayRun[];
}

const DEFAULT_HOME_RADIUS_M = 150;

/** The gap calendar of one year (spec 2026-11-22-gap-calendar). */
export async function gapCalendarYear(userId: string, year: number): Promise<GapCalendarYear> {
  ensureCacheInvalidation();
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { data: true },
  });
  const profile = profileZoneFromSettings(settings?.data);
  const nowMs = now().getTime();
  const generation = currentGeneration();
  const cached = cacheGet<GapCalendarYear>(userId, year, profile.zone, nowMs);
  if (cached) return cached;

  const [homePeriods, placeSettings] = await Promise.all([
    homePeriodsFromData(settings?.data),
    prisma.travTrackPlaceSettings.findUnique({
      where: { userId },
      select: { homeRadiusM: true },
    }),
  ]);
  const facts = await gapCalendarFacts({
    userId,
    zone: profile.zone,
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    homePeriods,
    homeRadiusM: placeSettings?.homeRadiusM ?? DEFAULT_HOME_RADIUS_M,
  });
  const today = todayIn(facts.zone);
  const { firstDay } = facts;
  const days = facts.days.map(({ day, facts: f }) => {
    // Outside the history (before the first record, after today) is not a gap.
    const outside = firstDay === null || day < firstDay || day > today;
    return {
      day,
      state: (outside ? "outside" : classifyDay(f)) as DayState,
      inferred: !outside && isInferredHome(f),
    };
  });
  const firstYear = firstDay ? Number(firstDay.slice(0, 4)) : null;
  const lastYear = Number(today.slice(0, 4));
  const result: GapCalendarYear = {
    year,
    zone: facts.zone,
    today,
    firstDay,
    years:
      firstYear === null
        ? []
        : Array.from({ length: Math.max(0, lastYear - firstYear + 1) }, (_, i) => firstYear + i),
    counts: countStates(days),
    runs: toRuns(days),
  };
  cachePut(userId, year, profile.zone, result, nowMs, generation);
  return result;
}
