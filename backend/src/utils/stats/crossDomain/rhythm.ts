/**
 * "When do I travel": distinct active days per season and per weekday
 * (forgejo#399), overall and per domain.
 *
 * Each figure counts DAYS, never events, and the overall figure is the union
 * of the domains' day sets — a Saturday with a flight and a hotel night is one
 * Saturday. Per-domain figures are each domain's own distinct days and are
 * NOT meant to be added up; the response names the overall one as the total.
 *
 * Seasons are the meteorological ones of the NORTHERN hemisphere (Dec-Feb
 * winter, ...), by calendar month of the day key. A traveller living in the
 * south reads them mirrored; the hemisphere is not stored, so the rule is
 * stated rather than guessed. Weekdays are read from the day key as a pure
 * calendar date (Monday first) — never from the host's clock.
 *
 * Abstention: no day at all -> `null`.
 */
export type Season = "winter" | "spring" | "summer" | "autumn";

export interface Rhythm {
  /** Distinct active days. */
  days: number;
  bySeason: Record<Season, number>;
  /** Monday first, length 7. */
  byWeekday: number[];
}

export interface CrossDomainRhythm {
  overall: Rhythm;
  byDomain: Record<string, Rhythm>;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function seasonOf(day: string): Season {
  const month = Number(day.slice(5, 7));
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

/** 0 = Monday ... 6 = Sunday, from the calendar date alone. */
export function weekdayIndexOf(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function rhythmOf(dayKeys: Iterable<string>): Rhythm | null {
  const days = [...new Set([...dayKeys].filter((d) => DAY_KEY.test(d)))];
  if (days.length === 0) return null;
  const bySeason: Record<Season, number> = { winter: 0, spring: 0, summer: 0, autumn: 0 };
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const day of days) {
    bySeason[seasonOf(day)] += 1;
    byWeekday[weekdayIndexOf(day)] += 1;
  }
  return { days: days.length, bySeason, byWeekday };
}

export function computeRhythm(
  daysByDomain: Readonly<Record<string, readonly string[]>>,
  today: string
): CrossDomainRhythm | null {
  const valid = (keys: readonly string[]): string[] =>
    keys.filter((d) => DAY_KEY.test(d) && d <= today);
  const byDomain: Record<string, Rhythm> = {};
  const all: string[] = [];
  for (const [domain, keys] of Object.entries(daysByDomain)) {
    const own = valid(keys);
    all.push(...own);
    const rhythm = rhythmOf(own);
    if (rhythm) byDomain[domain] = rhythm;
  }
  const overall = rhythmOf(all);
  return overall ? { overall, byDomain } : null;
}
