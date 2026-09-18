/**
 * How the cross-domain KPI strip adds four domains up — one home.
 *
 * The Gesamt tab shows three numbers over whichever domains the reader has
 * toggled on: experiences, countries, active travel days. Each is a
 * DIFFERENT kind of addition, and two of them are unions rather than sums:
 *
 *   - **events** add. One flight, one cruise, one stay, one place visit is
 *     one experience each, and a cruise counts in the year it STARTED.
 *   - **countries** union. A country reached both by air and by sea is one
 *     country, so the sets are merged and then counted, never summed.
 *   - **active days** union on the DAY KEY. Adding each domain's own tally
 *     counted a day with a flight and a hotel night twice and could push
 *     the figure past 365 in a year — the more domains a user keeps, the
 *     further off it read.
 *
 * The rules lived only in `frontend/.../Overview/aggregate.ts` until the
 * evidence panel had to answer the same three numbers from the server. Two
 * copies of a union rule is how the panel and its tile come to disagree, so
 * this module is the rule and both sides call it. What each side still owns
 * is where the CONTRIBUTIONS come from: the frontend folds the per-domain
 * adapters it already loaded, the backend derives them from rows.
 *
 * MIRRORED from `backend/src/shared/crossDomainCounting.ts`; change both
 * together. Each side has its own test of the same truth table, which is the
 * convention in this codebase — nothing checks the mirror itself.
 */
import type { DomainKey } from "./domains";

/** What ONE domain contributes to the strip, in the window already applied. */
export interface DomainContribution {
  domain: DomainKey;
  /** Events this domain counts — already narrowed to the selected year, or lifetime. */
  events: number;
  /** ISO 3166-1 alpha-2 codes this domain reached. Duplicates are harmless; it is a union. */
  countries: string[];
  /** `YYYY-MM-DD` keys this domain was active on. Duplicates are harmless. */
  activeDayKeys: string[];
  /**
   * Days a domain counts but cannot NAME — an adapter that predates the day
   * index hands over its own tally instead. Added rather than unioned, which
   * over-reports where two such domains share a day. That trade is
   * deliberate and stated where it was made: over-reporting is visible,
   * under-reporting silently loses days.
   */
  activeDaysWithoutIndex?: number;
}

export interface CrossDomainTotals {
  totalEvents: number;
  perDomainEvents: Partial<Record<DomainKey, number>>;
  countriesCount: number;
  activeDays: number;
}

export function foldCrossDomain(contributions: DomainContribution[]): CrossDomainTotals {
  const perDomainEvents: Partial<Record<DomainKey, number>> = {};
  const countries = new Set<string>();
  const activeDayKeys = new Set<string>();
  let totalEvents = 0;
  let activeDaysWithoutIndex = 0;

  for (const contribution of contributions) {
    perDomainEvents[contribution.domain] = contribution.events;
    totalEvents += contribution.events;
    for (const country of contribution.countries) countries.add(country);
    for (const day of contribution.activeDayKeys) activeDayKeys.add(day);
    activeDaysWithoutIndex += contribution.activeDaysWithoutIndex ?? 0;
  }

  return {
    totalEvents,
    perDomainEvents,
    countriesCount: countries.size,
    activeDays: activeDayKeys.size + activeDaysWithoutIndex,
  };
}

/** The day key the union is taken on: the calendar date, never an instant. */
export function crossDomainDayKey(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Whether a day key belongs to the selected year — a prefix test on the KEY
 * and not a re-reading of the date, because the key was already written on
 * the clock its own domain decided (a flight's departure airport, a stay's
 * UTC check-in). Re-parsing it here would apply a fifth clock to four
 * domains that had each already chosen one.
 */
export function dayKeyInYear(dayKey: string, year: number | null): boolean {
  return year === null || dayKey.startsWith(`${year}-`);
}
