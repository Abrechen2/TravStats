/**
 * Last visit and "not seen for N years" per country, airport and place
 * (forgejo#399). First visits already exist elsewhere; this is the other end.
 *
 * Input: dated sightings. The latest date per key is the last visit; the gap
 * is counted in WHOLE calendar years to `today` (an anniversary not yet
 * reached does not count). Only keys unseen for at least one whole year are
 * listed — "not seen for 0 years" is just "recently" — longest absence first,
 * capped so the payload stays small (`LAST_VISIT_LIMIT`).
 *
 * Abstention: a sighting without a usable date proves nothing about WHEN and
 * is dropped; a sighting dated after `today` (a plan) is not a visit. A kind
 * with no qualifying key is an empty list, and `null` when there was not a
 * single dated sighting of that kind to reason from.
 */
export const LAST_VISIT_LIMIT = 10;

export type SightingKind = "country" | "airport" | "place";

export interface Sighting {
  kind: SightingKind;
  key: string;
  label: string;
  /** `YYYY-MM-DD` or null when the record carries no date. */
  date: string | null;
}

export interface UnseenEntry {
  key: string;
  label: string;
  lastVisit: string;
  yearsAgo: number;
}

export type UnseenLists = Record<SightingKind, UnseenEntry[] | null>;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Whole years from `from` to `to` (both `YYYY-MM-DD`); an unreached anniversary does not count. */
export function wholeYearsBetween(from: string, to: string): number {
  let years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  if (to.slice(5) < from.slice(5)) years -= 1;
  return Math.max(0, years);
}

export function computeUnseen(sightings: readonly Sighting[], today: string): UnseenLists {
  const latest: Record<SightingKind, Map<string, UnseenEntry>> = {
    country: new Map(),
    airport: new Map(),
    place: new Map(),
  };
  for (const s of sightings) {
    if (!s.date || !DAY_KEY.test(s.date) || s.date > today) continue;
    const known = latest[s.kind].get(s.key);
    if (!known || s.date > known.lastVisit) {
      latest[s.kind].set(s.key, {
        key: s.key,
        label: s.label,
        lastVisit: s.date,
        yearsAgo: wholeYearsBetween(s.date, today),
      });
    }
  }
  const list = (kind: SightingKind): UnseenEntry[] | null => {
    if (latest[kind].size === 0) return null;
    return [...latest[kind].values()]
      .filter((e) => e.yearsAgo >= 1)
      .sort((a, b) => a.lastVisit.localeCompare(b.lastVisit) || a.key.localeCompare(b.key))
      .slice(0, LAST_VISIT_LIMIT);
  };
  return { country: list("country"), airport: list("airport"), place: list("place") };
}
