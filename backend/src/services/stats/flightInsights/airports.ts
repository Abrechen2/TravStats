/**
 * Airports over time (forgejo#256): which ones a year discovered, how long
 * the traveller stayed away from one before coming back, and which one they
 * used in every quarter of a year. Pure — rows in, answers out.
 *
 * ## The unit: an airport visit
 *
 * One END of a counted flight (`isCountedRow`: flown or historical) at an
 * airport it names, on that end's own local day (`./rows.ts`): the departure
 * on the day it left, the arrival on the day it landed. A change of planes is
 * two visits on one day, which every rule below folds into one day. An end
 * that names no airport, and a flight with no date, prove no visit — they are
 * counted apart (`coverage`) instead of being filed under a guessed day.
 *
 * ## What "new" means
 *
 * First visited according to EVERYTHING RECORDED — the whole logbook is the
 * reference, never the selected period. Travel before the first entry is
 * unknown to the app, so the first recorded year discovers every airport it
 * names; the copy says "first recorded", not "first ever".
 */

import type { FlightInsightRow } from "./rows";
import { isCountedRow } from "./rows";

export interface AirportVisit {
  airport: string;
  /** `YYYY-MM-DD` on the airport's own clock. */
  day: string;
  flightId: string;
  /**
   * The instant of this end, epoch ms, for ordering two visits of one day: a
   * landing at 17:00 came before a departure at 18:00, whatever their ids say.
   * Infinity where the end has no instant, so it sorts after the timed ones.
   */
  at: number;
  /** False for a placeholder date (`rows.ts`): it files a year, not a day. */
  exact: boolean;
}

/**
 * The visits whose DAY is real. Pauses in days and calendar quarters read the
 * day itself, so a placeholder date (a year-only entry) takes no part in them;
 * it still counts for the year it names.
 */
const exactOnly = (visits: readonly AirportVisit[]): AirportVisit[] =>
  visits.filter((v) => v.exact);

const instantOf = (utc: string | undefined): number => {
  const ms = utc ? Date.parse(utc) : NaN;
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
};

/** Every airport visit of the counted, dated flights, oldest first. */
export function airportVisits(rows: readonly FlightInsightRow[]): AirportVisit[] {
  const visits: AirportVisit[] = [];
  for (const row of rows) {
    if (!isCountedRow(row) || row.departureDay === null) continue;
    if (row.depCode) {
      visits.push({
        airport: row.depCode,
        day: row.departureDay,
        flightId: row.id,
        at: instantOf(row.departure?.utc),
        exact: row.departureDayExact,
      });
    }
    if (row.arrCode && row.arrivalDay) {
      visits.push({
        airport: row.arrCode,
        day: row.arrivalDay,
        flightId: row.id,
        at: instantOf(row.arrival?.utc ?? row.departure?.utc),
        exact: row.arrivalDayExact,
      });
    }
  }
  return visits.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.at - b.at ||
      a.airport.localeCompare(b.airport) ||
      a.flightId.localeCompare(b.flightId)
  );
}

const yearOf = (day: string): number => Number(day.slice(0, 4));

/** The visit that first recorded each airport — the evidence behind "new". */
export function firstVisits(visits: readonly AirportVisit[]): Map<string, AirportVisit> {
  const first = new Map<string, AirportVisit>();
  for (const visit of visits) if (!first.has(visit.airport)) first.set(visit.airport, visit);
  return first;
}

export interface YearAirports {
  year: number;
  /** Every airport visited in the year, sorted. */
  used: string[];
  /** The ones first recorded in the year, sorted. */
  discovered: string[];
}

export function airportsByYear(visits: readonly AirportVisit[]): YearAirports[] {
  const first = firstVisits(visits);
  const used = new Map<number, Set<string>>();
  for (const visit of visits) {
    const year = yearOf(visit.day);
    used.set(year, (used.get(year) ?? new Set()).add(visit.airport));
  }
  return [...used.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, set]) => ({
      year,
      used: [...set].sort(),
      discovered: [...set].filter((code) => yearOf(first.get(code)!.day) === year).sort(),
    }));
}

export interface Reunion {
  airport: string;
  fromDay: string;
  toDay: string;
  days: number;
  /** Whole calendar years completed between the two days. */
  years: number;
  fromFlightId: string;
  toFlightId: string;
}

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Whole years completed from `a` to `b` — 2014-06-01 → 2024-05-31 is nine, not ten. */
export function completedYears(a: string, b: string): number {
  const years = yearOf(b) - yearOf(a);
  return b.slice(5) < a.slice(5) ? years - 1 : years;
}

/**
 * For every airport visited on at least two days, its LONGEST pause: the two
 * consecutive visit days furthest apart. Longest first; ties by airport code.
 */
export function longestReunions(visits: readonly AirportVisit[]): Reunion[] {
  /** airport → day → the first and the last flight seen there that day. */
  const days = new Map<string, Map<string, { first: string; last: string }>>();
  for (const visit of exactOnly(visits)) {
    const byDay = days.get(visit.airport) ?? new Map<string, { first: string; last: string }>();
    const seen = byDay.get(visit.day);
    byDay.set(visit.day, { first: seen?.first ?? visit.flightId, last: visit.flightId });
    days.set(visit.airport, byDay);
  }
  const reunions: Reunion[] = [];
  for (const [airport, byDay] of days) {
    const ordered = [...byDay.keys()].sort();
    let best: Reunion | null = null;
    for (let i = 1; i < ordered.length; i += 1) {
      const gap = daysBetween(ordered[i - 1], ordered[i]);
      if (best === null || gap > best.days) {
        best = {
          airport,
          fromDay: ordered[i - 1],
          toDay: ordered[i],
          days: gap,
          years: completedYears(ordered[i - 1], ordered[i]),
          // The last flight before the pause and the first one after it.
          fromFlightId: byDay.get(ordered[i - 1])!.last,
          toFlightId: byDay.get(ordered[i])!.first,
        };
      }
    }
    if (best) reunions.push(best);
  }
  return reunions.sort((a, b) => b.days - a.days || a.airport.localeCompare(b.airport));
}

/** Every return to an airport (a pause between two visit days) that ended in `year`. */
export function reunionsEndingIn(visits: readonly AirportVisit[], year: number): Reunion[] {
  const seen = new Map<string, { day: string; flightId: string }>();
  const out: Reunion[] = [];
  for (const visit of exactOnly(visits)) {
    const last = seen.get(visit.airport);
    if (last && last.day !== visit.day && yearOf(visit.day) === year) {
      out.push({
        airport: visit.airport,
        fromDay: last.day,
        toDay: visit.day,
        days: daysBetween(last.day, visit.day),
        years: completedYears(last.day, visit.day),
        fromFlightId: last.flightId,
        toFlightId: visit.flightId,
      });
    }
    seen.set(visit.airport, { day: visit.day, flightId: visit.flightId });
  }
  return out.sort((a, b) => b.days - a.days || a.airport.localeCompare(b.airport));
}

/** Calendar quarter, 1-4, of a local day. Calendar quarters everywhere — not seasons. */
const quarterOf = (day: string): number => Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1;

export interface AirportQuarters {
  airport: string;
  year: number;
  quarters: number;
  /** The first visit in each quarter it was used in — the evidence, ordered by quarter. */
  visits: Array<{ quarter: number; day: string; flightId: string }>;
}

/**
 * Per airport and year, how many of the four calendar quarters it was used
 * in. The quarter is read on the airport's own calendar, like the day.
 */
export function quartersByAirportYear(visits: readonly AirportVisit[]): AirportQuarters[] {
  const seen = new Map<string, Map<number, { day: string; flightId: string }>>();
  for (const visit of exactOnly(visits)) {
    const key = `${visit.airport}|${yearOf(visit.day)}`;
    const byQuarter = seen.get(key) ?? new Map<number, { day: string; flightId: string }>();
    const quarter = quarterOf(visit.day);
    if (!byQuarter.has(quarter))
      byQuarter.set(quarter, { day: visit.day, flightId: visit.flightId });
    seen.set(key, byQuarter);
  }
  return [...seen.entries()]
    .map(([key, byQuarter]) => {
      const [airport, year] = key.split("|");
      return {
        airport,
        year: Number(year),
        quarters: byQuarter.size,
        visits: [...byQuarter.entries()]
          .sort(([a], [b]) => a - b)
          .map(([quarter, v]) => ({ quarter, ...v })),
      };
    })
    .sort(
      (a, b) => b.quarters - a.quarters || a.year - b.year || a.airport.localeCompare(b.airport)
    );
}
