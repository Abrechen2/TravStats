/**
 * The gap calendar's verdict on one day — the ONE place the precedence lives.
 * SQL only counts (`gapCalendarFacts` in `query.ts`); this decides. Abstention
 * is a result: a day nothing explains is `unknown`, a day outside the account's
 * history is `outside` and never a gap.
 */

export const DAY_STATES = [
  "entry",
  "home",
  "track",
  "privacyZone",
  "implausible",
  "unknown",
  "outside",
] as const;
export type DayState = (typeof DAY_STATES)[number];

/** What the database counted for one local day. */
export interface DayFacts {
  /** Logbook entries (any domain) whose span covers the day. */
  entries: number;
  /** Plausible fixes outside every privacy zone. */
  goodFixes: number;
  /** Of those, the ones inside the day's home residence radius. */
  homeFixes: number;
  /** Fixes inside a privacy zone (a count the response never carries). */
  zoneFixes: number;
  /** Fixes that are implausible (null island, accuracy over 10 km) and outside every zone. */
  badFixes: number;
}

/**
 * First match wins: entry > home > track > privacyZone > implausible > unknown.
 * `home` only with every plausible fix at home — one fix elsewhere is a track day.
 */
export function classifyDay(facts: DayFacts): Exclude<DayState, "outside"> {
  if (facts.entries > 0) return "entry";
  if (facts.goodFixes > 0) return facts.homeFixes === facts.goodFixes ? "home" : "track";
  if (facts.zoneFixes > 0) return "privacyZone";
  if (facts.badFixes > 0) return "implausible";
  return "unknown";
}

export interface DayRun {
  from: string;
  to: string;
  state: DayState;
}

/** Adjacent days of one state as one inclusive run. `days` are consecutive local dates in order. */
export function toRuns(days: ReadonlyArray<{ day: string; state: DayState }>): DayRun[] {
  const runs: DayRun[] = [];
  for (const { day, state } of days) {
    const last = runs[runs.length - 1];
    if (last && last.state === state) last.to = day;
    else runs.push({ from: day, to: day, state });
  }
  return runs;
}

export function countStates(days: ReadonlyArray<{ state: DayState }>): Record<DayState, number> {
  const counts = Object.fromEntries(DAY_STATES.map((s) => [s, 0])) as Record<DayState, number>;
  for (const { state } of days) counts[state] += 1;
  return counts;
}
