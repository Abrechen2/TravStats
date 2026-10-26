import { visitTime } from "../../lib/entityTimes";
import { classifyVisit } from "../../shared/placeCounting";
import { clockOf, dayOf, daysBetween, todayIn, type TimeValue } from "../../shared/time";
import type { PlaceVisit } from "../../types/place";

/**
 * The place page's visit list as data: which visit sits in which group, in
 * which order, and what the summary line says. Pure, so the order the tester
 * asked for (planned on top, next one first; the past by year, newest first;
 * undated last) is pinned by unit tests rather than by reading markup.
 */

export type VisitFilter = "all" | "visited" | "planned";
export type VisitState = "planned" | "done" | "undated";

export interface VisitEntry {
  visit: PlaceVisit;
  /** The visit's time at the place, or null for an undated visit. */
  when: TimeValue | null;
  state: VisitState;
  /** `YYYY-MM-DD` at the place. */
  day: string | null;
  /** `HH:mm` at the place — null for a visit known only to the day. */
  clock: string | null;
  /** Calendar days from today (at the place) to the visit; planned visits only. */
  daysAhead: number | null;
}

export type VisitGroup =
  | { kind: "planned"; entries: VisitEntry[] }
  | { kind: "year"; year: string; entries: VisitEntry[] }
  | { kind: "undated"; entries: VisitEntry[] };

export interface VisitListModel {
  groups: VisitGroup[];
  counts: { total: number; visited: number; planned: number };
  /** Past visits not rendered yet because of `pastLimit`. */
  hiddenPast: number;
  summary: {
    /** Visits that happened, undated ones included — what "n× besucht" says. */
    visited: number;
    last: VisitEntry | null;
    firstDated: VisitEntry | null;
    next: VisitEntry | null;
  };
}

export interface BuildOptions {
  now: Date;
  /** The zone "today" is read in when a visit carries none (a legacy row). */
  fallbackZone: string;
  filter: VisitFilter;
  /** How many past (dated, happened) visits to render. */
  pastLimit: number;
}

/** The first page of past visits; a long history loads the rest on request. */
export const PAST_PAGE_SIZE = 50;

/**
 * Planned or happened — `classifyVisit`, exactly as the server counts, so the
 * list and every figure beside it cannot disagree about a visit.
 */
function toEntry(visit: PlaceVisit, now: Date, fallbackZone: string): VisitEntry {
  const when = visitTime(visit);
  if (!when) {
    return { visit, when: null, state: "undated", day: null, clock: null, daysAhead: null };
  }
  const day = dayOf(when);
  const planned = classifyVisit(visit, now) === "planned";
  return {
    visit,
    when,
    state: planned ? "planned" : "done",
    day,
    clock: clockOf(when),
    daysAhead: planned ? daysBetween(todayIn(when.zone ?? fallbackZone, now), day) : null,
  };
}

const instantOf = (e: VisitEntry): number => (e.when ? Date.parse(e.when.utc) : Number.NaN);
const byId = (a: VisitEntry, b: VisitEntry): number => a.visit.id.localeCompare(b.visit.id);
const ascending = (a: VisitEntry, b: VisitEntry): number =>
  instantOf(a) - instantOf(b) || byId(a, b);
const descending = (a: VisitEntry, b: VisitEntry): number =>
  instantOf(b) - instantOf(a) || byId(a, b);
const entryOrder = (a: VisitEntry, b: VisitEntry): number =>
  a.visit.orderIdx - b.visit.orderIdx || a.visit.createdAt.localeCompare(b.visit.createdAt);

function yearGroups(entries: readonly VisitEntry[]): VisitGroup[] {
  const groups: Array<{ kind: "year"; year: string; entries: VisitEntry[] }> = [];
  for (const entry of entries) {
    const year = (entry.day ?? "").slice(0, 4);
    const last = groups[groups.length - 1];
    if (last && last.year === year) {
      groups[groups.length - 1] = { ...last, entries: [...last.entries, entry] };
    } else {
      groups.push({ kind: "year", year, entries: [entry] });
    }
  }
  return groups;
}

export function buildVisitList(
  visits: readonly PlaceVisit[],
  { now, fallbackZone, filter, pastLimit }: BuildOptions
): VisitListModel {
  const entries = visits.map((v) => toEntry(v, now, fallbackZone));
  const planned = entries.filter((e) => e.state === "planned").sort(ascending);
  const done = entries.filter((e) => e.state === "done").sort(descending);
  const undated = entries.filter((e) => e.state === "undated").sort(entryOrder);

  const showPlanned = filter !== "visited";
  const showPast = filter !== "planned";
  const shownPast = showPast ? done.slice(0, Math.max(0, pastLimit)) : [];

  const groups: VisitGroup[] = [];
  if (showPlanned && planned.length > 0) groups.push({ kind: "planned", entries: planned });
  groups.push(...yearGroups(shownPast));
  if (showPast && undated.length > 0) groups.push({ kind: "undated", entries: undated });

  return {
    groups,
    counts: {
      total: entries.length,
      visited: done.length + undated.length,
      planned: planned.length,
    },
    hiddenPast: showPast ? done.length - shownPast.length : 0,
    summary: {
      visited: done.length + undated.length,
      last: done[0] ?? null,
      firstDated: done[done.length - 1] ?? null,
      next: planned[0] ?? null,
    },
  };
}
