import { SEASON_BY_MONTH } from "../lodgingStats/rhythm";
import type { PreparedStay } from "./prepare";
import type { CalendarCoverage, CalendarYear, WeekRhythm, WeekRhythmYear } from "./types";

/** Friday and Saturday nights — the ones a working week does not need. 0 = Sunday. */
const WEEKEND_NIGHTS: ReadonlySet<number> = new Set([5, 6]);

/** Whether the night starting on this hotel-local day (UTC-midnight ms) is a weekend night. */
export function isWeekendNight(day: number): boolean {
  return WEEKEND_NIGHTS.has(new Date(day).getUTCDay());
}

function bucket(map: Map<number, WeekRhythmYear>, year: number): WeekRhythmYear {
  const found = map.get(year);
  if (found) return found;
  const fresh: WeekRhythmYear = {
    year,
    weekendNights: 0,
    weekdayNights: 0,
    businessNights: 0,
    nightsBySeason: {},
  };
  map.set(year, fresh);
  return fresh;
}

/**
 * Weekend against working-week nights, seasons per year, and business nights
 * (forgejo#258 item 5).
 *
 * The dates are the HOTEL's local calendar — a stay's check-in and check-out
 * are stored as the local days they name, so a weekday read off them is the
 * weekday on the spot, not on the server. Only a stay with two real dates has
 * weekdays; the rest are counted in `notWalkableNights` and nowhere else.
 *
 * A night is a business night ONLY when its trip is marked "business". Nothing
 * is inferred from a Tuesday: a weekday stay is just as often a holiday, and a
 * guessed purpose would be a fact the user never stated.
 */
export function computeWeekRhythm(counted: readonly PreparedStay[]): WeekRhythm {
  const years = new Map<number, WeekRhythmYear>();
  let weekendNights = 0;
  let weekdayNights = 0;
  let businessNights = 0;
  let unlabelledNights = 0;
  let notWalkableNights = 0;

  for (const p of counted) {
    const business = p.stay.trip?.category === "business";
    if (!p.stay.trip?.category) unlabelledNights += p.nights;
    if (business) {
      businessNights += p.nights;
      if (p.nightDays.length === 0 && p.year !== null) {
        bucket(years, p.year).businessNights += p.nights;
      }
    }
    if (p.nightDays.length === 0) {
      notWalkableNights += p.nights;
      continue;
    }
    for (const day of p.nightDays) {
      const d = new Date(day);
      const y = bucket(years, d.getUTCFullYear());
      if (isWeekendNight(day)) {
        y.weekendNights += 1;
        weekendNights += 1;
      } else {
        y.weekdayNights += 1;
        weekdayNights += 1;
      }
      if (business) y.businessNights += 1;
      const season = SEASON_BY_MONTH[d.getUTCMonth()];
      y.nightsBySeason[season] = (y.nightsBySeason[season] ?? 0) + 1;
    }
  }

  return {
    byYear: [...years.values()].sort((a, b) => a.year - b.year),
    weekendNights,
    weekdayNights,
    businessNights,
    unlabelledNights,
    notWalkableNights,
  };
}

/**
 * Which months of each year hold a night (the "Einmal durch den Kalender"
 * measure). A stay recorded to the month proves a night in THAT month and is
 * counted; one known only to the year proves no month and is not — a missing
 * month is never filled in from a year.
 */
export function computeCalendar(counted: readonly PreparedStay[]): CalendarCoverage {
  const months = new Map<number, Set<number>>();
  const mark = (year: number, month: number): void => {
    const set = months.get(year) ?? new Set<number>();
    set.add(month);
    months.set(year, set);
  };
  for (const p of counted) {
    if (p.nightDays.length > 0) {
      for (const day of p.nightDays) {
        const d = new Date(day);
        mark(d.getUTCFullYear(), d.getUTCMonth() + 1);
      }
      continue;
    }
    if (p.timing.precision === "MONTH" && p.timing.anchor && p.nights > 0) {
      mark(p.timing.anchor.getUTCFullYear(), p.timing.anchor.getUTCMonth() + 1);
    }
  }
  const byYear: CalendarYear[] = [...months.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, set]) => ({ year, months: [...set].sort((a, b) => a - b) }));
  return {
    byYear,
    fullYears: byYear.filter((y) => y.months.length === 12).map((y) => y.year),
    monthsInYearMax: Math.max(0, ...byYear.map((y) => y.months.length)),
  };
}
