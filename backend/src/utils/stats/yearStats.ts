import { DOMAIN_KEYS, type DomainKey } from "../../shared/domains";

/**
 * Distance per year and month, across the travel domains (the "Jahre" cards of the statistics
 * page). Pure: the loaders in `services/stats/yearStats/` hand over what each domain logged, and
 * this decides what a year says.
 *
 * Two things are kept apart ON PURPOSE:
 *  - logged distance — what the logbook's entries measured, by domain;
 *  - recorded distance — TravTrack's ground kilometres. A recording can contain the very train
 *    ride that is also logged, so the two are never added: a sum would count it twice.
 *
 * Abstention: an entry without a measurable distance still makes its year exist (the card says
 * "keine Strecken"), but adds nothing; a month with no distance is `null`, never a zero.
 */

/** One distance-bearing entry, filed under the local month it belongs to. */
export interface DistanceEntry {
  domain: DomainKey;
  /** `YYYY-MM` (anything longer is cut) on the entry's own calendar. */
  month: string;
  /** Null or not positive = no measured distance. */
  km: number | null;
}

export interface RecordedMonth {
  /** `YYYY-MM` — a UTC month, as TravTrack stores it. */
  month: string;
  km: number;
}

export interface YearMonth {
  /** 1-12. */
  month: number;
  loggedKm: number | null;
  byDomain: Partial<Record<DomainKey, number>>;
  recordedKm: number | null;
}

export interface YearCard {
  year: number;
  loggedKm: number | null;
  recordedKm: number | null;
  /** Always twelve, January first. */
  months: YearMonth[];
}

export interface YearStats {
  totals: {
    loggedKm: number | null;
    recordedKm: number | null;
    recordedPoints: number | null;
  };
  /** Newest year first. */
  years: YearCard[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const measured = (km: number | null): km is number => km !== null && Number.isFinite(km) && km > 0;
const parts = (key: string): { year: number; month: number } | null => {
  const m = /^(\d{4})-(\d{2})/.exec(key);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null;
};

export function buildYearStats(input: {
  entries: readonly DistanceEntry[];
  recordedMonths: readonly RecordedMonth[] | null;
  recordedPoints: number | null;
}): YearStats {
  const cards = new Map<number, YearCard>();
  const card = (year: number): YearCard => {
    let c = cards.get(year);
    if (!c) {
      c = {
        year,
        loggedKm: null,
        recordedKm: null,
        months: Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          loggedKm: null,
          byDomain: {},
          recordedKm: null,
        })),
      };
      cards.set(year, c);
    }
    return c;
  };

  for (const e of input.entries) {
    const at = parts(e.month);
    if (!at) continue;
    const c = card(at.year);
    if (!measured(e.km)) continue;
    const m = c.months[at.month - 1];
    m.byDomain[e.domain] = (m.byDomain[e.domain] ?? 0) + e.km;
    m.loggedKm = (m.loggedKm ?? 0) + e.km;
    c.loggedKm = (c.loggedKm ?? 0) + e.km;
  }
  for (const r of input.recordedMonths ?? []) {
    const at = parts(r.month);
    if (!at || !measured(r.km)) continue;
    const c = card(at.year);
    const m = c.months[at.month - 1];
    m.recordedKm = (m.recordedKm ?? 0) + r.km;
    c.recordedKm = (c.recordedKm ?? 0) + r.km;
  }

  const years = [...cards.values()].sort((a, b) => b.year - a.year);
  let logged: number | null = null;
  let recorded: number | null = null;
  for (const c of years) {
    if (c.loggedKm !== null) logged = (logged ?? 0) + c.loggedKm;
    if (c.recordedKm !== null) recorded = (recorded ?? 0) + c.recordedKm;
    // Rounded last, so the total is the sum of the true figures, not of rounded ones.
    for (const m of c.months) {
      if (m.loggedKm !== null) m.loggedKm = round1(m.loggedKm);
      if (m.recordedKm !== null) m.recordedKm = round1(m.recordedKm);
      for (const k of DOMAIN_KEYS) {
        const v = m.byDomain[k];
        if (v !== undefined) m.byDomain[k] = round1(v);
      }
    }
    if (c.loggedKm !== null) c.loggedKm = round1(c.loggedKm);
    if (c.recordedKm !== null) c.recordedKm = round1(c.recordedKm);
  }
  return {
    totals: {
      loggedKm: logged === null ? null : round1(logged),
      recordedKm: recorded === null ? null : round1(recorded),
      recordedPoints: input.recordedPoints,
    },
    years,
  };
}
