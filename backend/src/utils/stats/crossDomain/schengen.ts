/**
 * Schengen 90/180 day counter (forgejo#399).
 *
 * The rule: within ANY rolling 180-day window a short-stay visitor may be
 * present in the Schengen area for at most 90 days. The counter answers the
 * question for today: how many distinct days with a record in a Schengen
 * country fall in the 180 days ending today (inclusive), and so how many of
 * the 90 remain.
 *
 * This is a LOGBOOK count, not legal advice, and the response says so: it
 * counts every day on which a record (flight, stay, ride, place visit) puts
 * the traveller in a member country. A day with no record is not a day
 * outside — the same abstention the rest of the statistics keep — and a
 * citizen or resident of the area is not subject to the rule at all, which
 * the client explains. `windowDays` is returned so nobody has to guess.
 *
 * Membership is dated: a country counts only from the day it joined
 * (Croatia 2023-01-01; Bulgaria and Romania 2024-03-31, the day their air and
 * sea borders opened — the earlier of their two accession steps, so the
 * counter errs towards counting). Non-EU members (IS, LI, NO, CH) are in.
 * Microstates with open borders (MC, SM, VA, AD) are not listed: their days
 * are left out rather than guessed.
 *
 * Abstention: with no dated presence row in any country at all, `daysUsed`
 * is `null` — an empty logbook cannot show 0 days of 90 used and call it
 * "90 left". With presence rows elsewhere in the world and none in the area,
 * 0 used is a derived fact.
 */
export const SCHENGEN_ALLOWED_DAYS = 90;
export const SCHENGEN_WINDOW_DAYS = 180;

/** Member -> first day it counts. */
export const SCHENGEN_MEMBERS: Readonly<Record<string, string>> = {
  AT: "1995-03-26",
  BE: "1995-03-26",
  BG: "2024-03-31",
  CH: "2008-12-12",
  CZ: "2007-12-21",
  DE: "1995-03-26",
  DK: "2001-03-25",
  EE: "2007-12-21",
  ES: "1995-03-26",
  FI: "2001-03-25",
  FR: "1995-03-26",
  GR: "2000-01-01",
  HR: "2023-01-01",
  HU: "2007-12-21",
  IS: "2001-03-25",
  IT: "1997-10-26",
  LI: "2011-12-19",
  LT: "2007-12-21",
  LU: "1995-03-26",
  LV: "2007-12-21",
  MT: "2007-12-21",
  NL: "1995-03-26",
  NO: "2001-03-25",
  PL: "2007-12-21",
  PT: "1995-03-26",
  RO: "2024-03-31",
  SE: "2001-03-25",
  SI: "2007-12-21",
  SK: "2007-12-21",
};

export interface PresenceDay {
  /** `YYYY-MM-DD` */
  date: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
}

export interface SchengenCounter {
  asOf: string;
  windowDays: number;
  allowedDays: number;
  daysUsed: number;
  daysRemaining: number;
  /** The first day of the 180-day window ending `asOf`. */
  windowFrom: string;
  /** The most recent day in the window with a record in the area; null when none. */
  lastDayUsed: string | null;
}

export function isSchengenDay(day: PresenceDay): boolean {
  const joined = SCHENGEN_MEMBERS[day.country.toUpperCase()];
  return joined !== undefined && day.date >= joined;
}

export function computeSchengen(
  presence: readonly PresenceDay[],
  today: string
): SchengenCounter | null {
  if (presence.length === 0) return null;
  const windowFrom = new Date(
    Date.parse(`${today}T00:00:00Z`) - (SCHENGEN_WINDOW_DAYS - 1) * 86_400_000
  )
    .toISOString()
    .slice(0, 10);
  const used = new Set<string>();
  for (const day of presence) {
    if (day.date < windowFrom || day.date > today) continue;
    if (isSchengenDay(day)) used.add(day.date);
  }
  const sorted = [...used].sort();
  return {
    asOf: today,
    windowDays: SCHENGEN_WINDOW_DAYS,
    allowedDays: SCHENGEN_ALLOWED_DAYS,
    daysUsed: used.size,
    daysRemaining: Math.max(0, SCHENGEN_ALLOWED_DAYS - used.size),
    windowFrom,
    lastDayUsed: sorted.length > 0 ? sorted[sorted.length - 1] : null,
  };
}
